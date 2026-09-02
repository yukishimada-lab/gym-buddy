-- ============================================================
-- gym-buddy / Phase 1: 初期スキーマ(種目・ワークアウト記録・ルーティン)
--
-- 由来: もとの supabase/schema.sql(現在は supabase/legacy/schema.sql)
-- 本番 Supabase には適用済みです。GitHub Actions のワークフローは
-- このマイグレーションを「適用済み」として登録してからプッシュするため、
-- 通常このファイルが本番で再実行されることはありません。
--
-- ★ 冪等(何度実行しても同じ結果)・非破壊:
--   DROP TABLE / TRUNCATE / DELETE は 1 つも含まれていません。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 種目マスタ (exercises)
--    ユーザーごとに管理する種目(ベンチプレス、スクワット等)
-- ------------------------------------------------------------
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  muscle_group text,                    -- 部位(胸 / 背中 / 肩 / 腕 / 脚 / 体幹 / 有酸素 / その他)
  created_at   timestamptz not null default now()
);

create index if not exists exercises_user_id_idx on public.exercises (user_id);

-- ------------------------------------------------------------
-- 2. ワークアウト記録 (workout_logs)
--    日付ごとに 種目・重量(kg)・回数(レップ)・セット数 を記録
-- ------------------------------------------------------------
create table if not exists public.workout_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  workout_date date not null default current_date,
  exercise_id  uuid not null references public.exercises (id) on delete cascade,
  weight_kg    numeric(6, 2) not null default 0 check (weight_kg >= 0),
  reps         integer not null default 0 check (reps >= 0),
  sets         integer not null default 0 check (sets >= 0),
  memo         text,
  created_at   timestamptz not null default now()
);

create index if not exists workout_logs_user_date_idx
  on public.workout_logs (user_id, workout_date desc);

-- ------------------------------------------------------------
-- 3. ルーティン (routines / routine_items)
--    「胸の日」「脚の日」のような種目の組み合わせテンプレート
-- ------------------------------------------------------------
create table if not exists public.routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index if not exists routines_user_id_idx on public.routines (user_id);

create table if not exists public.routine_items (
  id                uuid primary key default gen_random_uuid(),
  routine_id        uuid not null references public.routines (id) on delete cascade,
  exercise_id       uuid not null references public.exercises (id) on delete cascade,
  default_weight_kg numeric(6, 2) check (default_weight_kg >= 0),
  default_reps      integer not null default 10 check (default_reps >= 0),
  default_sets      integer not null default 3 check (default_sets >= 0),
  sort_order        integer not null default 0
);

create index if not exists routine_items_routine_id_idx
  on public.routine_items (routine_id);

-- ------------------------------------------------------------
-- 4. Row Level Security (RLS)
--    各ユーザーは自分のデータにのみアクセスできる
-- ------------------------------------------------------------
alter table public.exercises     enable row level security;
alter table public.workout_logs  enable row level security;
alter table public.routines      enable row level security;
alter table public.routine_items enable row level security;

-- exercises
drop policy if exists "own exercises: select" on public.exercises;
create policy "own exercises: select" on public.exercises
  for select using (auth.uid() = user_id);

drop policy if exists "own exercises: insert" on public.exercises;
create policy "own exercises: insert" on public.exercises
  for insert with check (auth.uid() = user_id);

drop policy if exists "own exercises: update" on public.exercises;
create policy "own exercises: update" on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own exercises: delete" on public.exercises;
create policy "own exercises: delete" on public.exercises
  for delete using (auth.uid() = user_id);

-- workout_logs
drop policy if exists "own workout_logs: select" on public.workout_logs;
create policy "own workout_logs: select" on public.workout_logs
  for select using (auth.uid() = user_id);

drop policy if exists "own workout_logs: insert" on public.workout_logs;
create policy "own workout_logs: insert" on public.workout_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own workout_logs: update" on public.workout_logs;
create policy "own workout_logs: update" on public.workout_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own workout_logs: delete" on public.workout_logs;
create policy "own workout_logs: delete" on public.workout_logs
  for delete using (auth.uid() = user_id);

-- routines
drop policy if exists "own routines: select" on public.routines;
create policy "own routines: select" on public.routines
  for select using (auth.uid() = user_id);

drop policy if exists "own routines: insert" on public.routines;
create policy "own routines: insert" on public.routines
  for insert with check (auth.uid() = user_id);

drop policy if exists "own routines: update" on public.routines;
create policy "own routines: update" on public.routines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own routines: delete" on public.routines;
create policy "own routines: delete" on public.routines
  for delete using (auth.uid() = user_id);

-- routine_items(親ルーティンの所有者のみアクセス可)
drop policy if exists "own routine_items: select" on public.routine_items;
create policy "own routine_items: select" on public.routine_items
  for select using (
    exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "own routine_items: insert" on public.routine_items;
create policy "own routine_items: insert" on public.routine_items
  for insert with check (
    exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
    and exists (
      select 1 from public.exercises e
      where e.id = exercise_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "own routine_items: update" on public.routine_items;
create policy "own routine_items: update" on public.routine_items
  for update using (
    exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "own routine_items: delete" on public.routine_items;
create policy "own routine_items: delete" on public.routine_items
  for delete using (
    exists (
      select 1 from public.routines r
      where r.id = routine_id and r.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- 5. 新規ユーザーへの初期種目の自動登録
--    サインアップ時に代表的な種目を自動でコピーする
--    (アプリ側にも「代表的な種目をまとめて登録」ボタンあり)
-- ------------------------------------------------------------
create or replace function public.seed_default_exercises()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exercises (user_id, name, muscle_group)
  values
    (new.id, 'ベンチプレス', '胸'),
    (new.id, 'ダンベルフライ', '胸'),
    (new.id, 'インクラインベンチプレス', '胸'),
    (new.id, 'デッドリフト', '背中'),
    (new.id, 'ラットプルダウン', '背中'),
    (new.id, 'ベントオーバーロー', '背中'),
    (new.id, 'ショルダープレス', '肩'),
    (new.id, 'サイドレイズ', '肩'),
    (new.id, 'バーベルカール', '腕'),
    (new.id, 'トライセプスエクステンション', '腕'),
    (new.id, 'スクワット', '脚'),
    (new.id, 'レッグプレス', '脚'),
    (new.id, 'レッグカール', '脚'),
    (new.id, 'アブローラー', '体幹'),
    (new.id, 'プランク', '体幹');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_default_exercises();
