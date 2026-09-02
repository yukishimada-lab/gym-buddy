-- ============================================================
-- gym-buddy: データベーススキーマ (Phase 4: 並べ替え / セット単位の記録 / からだ記録の統合)
--
-- Supabase ダッシュボードの「SQL Editor」にこのファイルの内容を
-- 貼り付けて「Run」を押すだけでセットアップできます。
--
-- ★ 既存データを消さない設計です。
--   - テーブルの DROP / 再作成は一切していません
--   - 追加は ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - 移行は INSERT ... SELECT(ON CONFLICT DO NOTHING)+ 穴埋め UPDATE
--   - 何度実行しても結果が変わらない(冪等)ように書いています
--
-- 実行順の前提: schema.sql → phase2.sql → phase3.sql → phase4.sql
-- ============================================================


-- ============================================================
-- 0. 共通: updated_at 自動更新関数(phase3.sql と同じもの。無い場合に備えて再定義)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 1. ルーティンの並び順(routine_items.sort_order)の整備
--
--    sort_order カラム自体は schema.sql の時点で存在するが、
--    既存レコードはすべて 0 のままで並び順が保持されていない可能性がある。
--    現在の表示順(sort_order → id の昇順 = これまで画面に出ていた順)を
--    そのまま 1, 2, 3... に振り直す。
--    すでに 1..n が振られている場合は同じ値が入るだけなので冪等。
-- ============================================================
alter table public.routine_items
  add column if not exists sort_order integer not null default 0;

with ordered as (
  select
    id,
    row_number() over (partition by routine_id order by sort_order, id) as rn
  from public.routine_items
)
update public.routine_items ri
set sort_order = ordered.rn
from ordered
where ordered.id = ri.id
  and ri.sort_order is distinct from ordered.rn;


-- ============================================================
-- 2. ワークアウト記録: 並び順 + セット単位のデータモデル
-- ============================================================

-- ------------------------------------------------------------
-- 2-1. workout_logs に並び順(sort_order)を追加
--      既存レコードは「その日の中での作成順」で 1, 2, 3... を振る。
-- ------------------------------------------------------------
alter table public.workout_logs
  add column if not exists sort_order integer not null default 0;

with ordered as (
  select
    id,
    row_number() over (
      partition by user_id, workout_date
      order by sort_order, created_at, id
    ) as rn
  from public.workout_logs
)
update public.workout_logs wl
set sort_order = ordered.rn
from ordered
where ordered.id = wl.id
  and wl.sort_order is distinct from ordered.rn;

create index if not exists workout_logs_user_date_sort_idx
  on public.workout_logs (user_id, workout_date, sort_order);

-- ------------------------------------------------------------
-- 2-2. セット単位の記録 (workout_sets)
--      「1セット目 80kg×10回 / 2セット目 80kg×8回 / 3セット目 70kg×8回」
--      のように、セットごとに重量と回数を持たせるための子テーブル。
--      親 (workout_logs) が消えたらセットも消える。
-- ------------------------------------------------------------
create table if not exists public.workout_sets (
  id             uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  set_number     integer not null default 1 check (set_number > 0),
  weight_kg      numeric(6, 2) not null default 0 check (weight_kg >= 0),
  reps           integer not null default 0 check (reps >= 0),
  created_at     timestamptz not null default now(),
  unique (workout_log_id, set_number)
);

create index if not exists workout_sets_log_idx
  on public.workout_sets (workout_log_id, set_number);

-- ------------------------------------------------------------
-- 2-3. 既存データの移行
--      「重量 80kg・回数 10回・セット数 3」というレコードを
--      「80kg×10回」のセットを 3 行、に展開する。
--      すでにセットが 1 件でもある記録はスキップするので何度実行しても安全。
--      セット数が 0 の記録も 1 セットとして残す(記録自体を失わないため)。
-- ------------------------------------------------------------
insert into public.workout_sets (workout_log_id, set_number, weight_kg, reps)
select
  l.id,
  s.n,
  l.weight_kg,
  l.reps
from public.workout_logs l
cross join lateral
  generate_series(1, greatest(coalesce(l.sets, 0), 1)) as s(n)
where not exists (
  select 1 from public.workout_sets ws where ws.workout_log_id = l.id
);

-- ------------------------------------------------------------
-- 2-4. 旧カラム (weight_kg / reps / sets) の扱い
--      アプリは workout_sets のみを参照するようになったが、
--      過去データを消さないためカラムは残す。
--      そのままだと値が古くなって紛らわしいので、
--      セットの内容から「最大重量 / 最大回数 / セット数」を自動で書き戻す。
-- ------------------------------------------------------------
create or replace function public.recalc_workout_log_totals(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null then
    return;
  end if;
  update public.workout_logs l
  set
    sets      = coalesce(agg.set_count, 0),
    weight_kg = coalesce(agg.max_weight, 0),
    reps      = coalesce(agg.max_reps, 0)
  from (
    select
      count(*)::int     as set_count,
      max(ws.weight_kg) as max_weight,
      max(ws.reps)      as max_reps
    from public.workout_sets ws
    where ws.workout_log_id = target_id
  ) as agg
  where l.id = target_id;
end;
$$;

create or replace function public.sync_workout_log_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- DELETE では NEW が、INSERT では OLD が使えないので TG_OP で振り分ける
  if tg_op <> 'INSERT' then
    perform public.recalc_workout_log_totals(old.workout_log_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.recalc_workout_log_totals(new.workout_log_id);
  end if;
  return null;
end;
$$;

drop trigger if exists workout_sets_sync_totals on public.workout_sets;
create trigger workout_sets_sync_totals
  after insert or update or delete on public.workout_sets
  for each row execute function public.sync_workout_log_totals();

-- 移行済みの記録にも集計値を一度そろえておく
update public.workout_logs l
set
  sets      = coalesce(agg.set_count, l.sets),
  weight_kg = coalesce(agg.max_weight, l.weight_kg),
  reps      = coalesce(agg.max_reps, l.reps)
from (
  select
    workout_log_id,
    count(*)::int     as set_count,
    max(weight_kg)    as max_weight,
    max(reps)         as max_reps
  from public.workout_sets
  group by workout_log_id
) as agg
where agg.workout_log_id = l.id
  and (
    l.sets is distinct from agg.set_count
    or l.weight_kg is distinct from agg.max_weight
    or l.reps is distinct from agg.max_reps
  );

-- ------------------------------------------------------------
-- 2-5. workout_sets の RLS(親 workout_logs の所有者のみアクセス可)
-- ------------------------------------------------------------
alter table public.workout_sets enable row level security;

drop policy if exists "own workout_sets: select" on public.workout_sets;
create policy "own workout_sets: select" on public.workout_sets
  for select using (
    exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "own workout_sets: insert" on public.workout_sets;
create policy "own workout_sets: insert" on public.workout_sets
  for insert with check (
    exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "own workout_sets: update" on public.workout_sets;
create policy "own workout_sets: update" on public.workout_sets
  for update using (
    exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_id and l.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "own workout_sets: delete" on public.workout_sets;
create policy "own workout_sets: delete" on public.workout_sets
  for delete using (
    exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_id and l.user_id = auth.uid()
    )
  );


-- ============================================================
-- 3. からだの記録の統合 (weight_logs + inbody_logs → body_logs)
--
--    体重記録と InBody 記録で項目が重複していたので 1 テーブルにまとめる。
--    「日付ごとに 1 件」「体重が主役、InBody の項目はすべて任意」。
-- ============================================================
create table if not exists public.body_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  log_date           date not null default current_date,
  -- 体重: アプリ側では必須入力。
  -- ただし「体重が入っていない InBody 記録」を移行時に取りこぼさないよう、
  -- DB 上は NULL を許容している(移行データのみ NULL になり得る)。
  weight_kg          numeric(5, 2) check (weight_kg > 0 and weight_kg < 500),
  body_fat_percent   numeric(4, 1) check (body_fat_percent >= 0 and body_fat_percent <= 100), -- 体脂肪率 (%)
  skeletal_muscle_kg numeric(5, 2) check (skeletal_muscle_kg >= 0),                           -- 骨格筋量 (kg)
  body_fat_mass_kg   numeric(5, 2) check (body_fat_mass_kg >= 0),                             -- 体脂肪量 (kg)
  bmr_kcal           numeric(6, 1) check (bmr_kcal >= 0),                                     -- 基礎代謝量 (kcal)
  body_water_l       numeric(5, 2) check (body_water_l >= 0),                                 -- 体水分量 (L)
  memo               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, log_date)
);

create index if not exists body_logs_user_date_idx
  on public.body_logs (user_id, log_date desc);

drop trigger if exists body_logs_set_updated_at on public.body_logs;
create trigger body_logs_set_updated_at
  before update on public.body_logs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3-1. weight_logs からの移行(同じ日付が既にあれば触らない)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.weight_logs') is not null then
    insert into public.body_logs (
      user_id, log_date, weight_kg, memo, created_at, updated_at
    )
    select w.user_id, w.log_date, w.weight_kg, w.memo, w.created_at, w.updated_at
    from public.weight_logs w
    on conflict (user_id, log_date) do nothing;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3-2. inbody_logs からの移行(まだその日付の記録が無い場合)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.inbody_logs') is not null then
    insert into public.body_logs (
      user_id, log_date, weight_kg, body_fat_percent, skeletal_muscle_kg,
      body_fat_mass_kg, bmr_kcal, body_water_l, memo, created_at, updated_at
    )
    select
      i.user_id, i.measured_date, i.weight_kg, i.body_fat_percent, i.skeletal_muscle_kg,
      i.body_fat_mass_kg, i.bmr_kcal, i.body_water_l, i.memo, i.created_at, i.updated_at
    from public.inbody_logs i
    on conflict (user_id, log_date) do nothing;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3-3. 同じ日付に体重記録と InBody 記録の両方があった場合のマージ
--      統合先で「まだ空(NULL)の項目」だけを InBody の値で埋める。
--      すでに値がある項目は上書きしないので、移行後にアプリで編集した内容も守られる。
--      メモは重複しないときだけ「/」で連結する。
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.inbody_logs') is null then
    return;
  end if;

  update public.body_logs b
  set
    weight_kg          = coalesce(b.weight_kg, i.weight_kg),
    body_fat_percent   = coalesce(b.body_fat_percent, i.body_fat_percent),
    skeletal_muscle_kg = coalesce(b.skeletal_muscle_kg, i.skeletal_muscle_kg),
    body_fat_mass_kg   = coalesce(b.body_fat_mass_kg, i.body_fat_mass_kg),
    bmr_kcal           = coalesce(b.bmr_kcal, i.bmr_kcal),
    body_water_l       = coalesce(b.body_water_l, i.body_water_l),
    memo               = case
                           when b.memo is null or btrim(b.memo) = '' then i.memo
                           when i.memo is null or btrim(i.memo) = '' then b.memo
                           when position(i.memo in b.memo) > 0 then b.memo
                           else b.memo || ' / ' || i.memo
                         end
  from public.inbody_logs i
  where i.user_id = b.user_id
    and i.measured_date = b.log_date
    and (
      (b.weight_kg is null and i.weight_kg is not null)
      or (b.body_fat_percent is null and i.body_fat_percent is not null)
      or (b.skeletal_muscle_kg is null and i.skeletal_muscle_kg is not null)
      or (b.body_fat_mass_kg is null and i.body_fat_mass_kg is not null)
      or (b.bmr_kcal is null and i.bmr_kcal is not null)
      or (b.body_water_l is null and i.body_water_l is not null)
      -- メモだけを持つ InBody 記録のための条件。
      -- 「統合先のメモがまだ空のとき」に限定しているので、移行後にユーザーが
      -- メモを書き換えても、再実行で古いメモが混ざることはない。
      or (
        i.memo is not null and btrim(i.memo) <> ''
        and (b.memo is null or btrim(b.memo) = '')
      )
    );
end
$$;

-- ------------------------------------------------------------
-- 3-4. body_logs の RLS
-- ------------------------------------------------------------
alter table public.body_logs enable row level security;

drop policy if exists "own body_logs: select" on public.body_logs;
create policy "own body_logs: select" on public.body_logs
  for select using (auth.uid() = user_id);

drop policy if exists "own body_logs: insert" on public.body_logs;
create policy "own body_logs: insert" on public.body_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own body_logs: update" on public.body_logs;
create policy "own body_logs: update" on public.body_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own body_logs: delete" on public.body_logs;
create policy "own body_logs: delete" on public.body_logs
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3-5. 旧テーブル (weight_logs / inbody_logs) について
--      アプリからは参照しなくなりますが、移行結果を確認できるよう
--      このスクリプトでは削除していません。
--      「からだ」画面の記録がすべて正しく表示されることを確認したうえで、
--      不要になったら手動で以下を実行して削除してください(任意)。
--
--        drop table if exists public.weight_logs;
--        drop table if exists public.inbody_logs;
-- ------------------------------------------------------------
