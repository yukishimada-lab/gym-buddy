-- ============================================================
-- gym-buddy / Phase 3: 体重・InBody データの記録と目標サポート
--
-- 由来: もとの supabase/phase3.sql(現在は supabase/legacy/phase3.sql)
-- 本番 Supabase には適用済みです。
--
-- ★ 冪等・非破壊: DROP TABLE / TRUNCATE / DELETE は含まれていません。
--
-- ※ ここで作る weight_logs / inbody_logs は Phase 4 で body_logs に
--   統合されます。移行元として必要なため、このマイグレーションは
--   当時のまま残しています。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 体重記録 (weight_logs)
--    1 日 1 件を基本とするため (user_id, log_date) を一意にする。
--    同じ日に再度記録した場合は upsert で上書きされる。
-- ------------------------------------------------------------
create table if not exists public.weight_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  log_date   date not null default current_date,
  weight_kg  numeric(5, 2) not null check (weight_kg > 0 and weight_kg < 500),
  memo       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create index if not exists weight_logs_user_date_idx
  on public.weight_logs (user_id, log_date desc);

-- ------------------------------------------------------------
-- 2. InBody 記録 (inbody_logs)
--    測定日ごとの体組成データ。項目はすべて任意(NULL 可)にして、
--    測定機器や測定内容によって入力できる項目だけ記録できるようにする。
--    体重記録と同じく (user_id, measured_date) を一意にする。
-- ------------------------------------------------------------
create table if not exists public.inbody_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  measured_date      date not null default current_date,
  weight_kg          numeric(5, 2) check (weight_kg > 0 and weight_kg < 500),          -- 体重 (kg)
  body_fat_percent   numeric(4, 1) check (body_fat_percent >= 0 and body_fat_percent <= 100), -- 体脂肪率 (%)
  skeletal_muscle_kg numeric(5, 2) check (skeletal_muscle_kg >= 0),                    -- 骨格筋量 (kg)
  body_fat_mass_kg   numeric(5, 2) check (body_fat_mass_kg >= 0),                      -- 体脂肪量 (kg)
  bmr_kcal           numeric(6, 1) check (bmr_kcal >= 0),                              -- 基礎代謝量 (kcal)
  body_water_l       numeric(5, 2) check (body_water_l >= 0),                          -- 体水分量 (L)
  memo               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, measured_date)
);

create index if not exists inbody_logs_user_date_idx
  on public.inbody_logs (user_id, measured_date desc);

-- ------------------------------------------------------------
-- 3. 目標設定 (body_goals)
--    1 ユーザーにつき 1 件(現在の目標)。すべての項目は任意。
--    mode: bulk = 増量 / cut = 減量 / maintain = 維持
-- ------------------------------------------------------------
create table if not exists public.body_goals (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users (id) on delete cascade,
  mode                    text not null default 'maintain' check (mode in ('bulk', 'cut', 'maintain')),
  target_weight_kg        numeric(5, 2) check (target_weight_kg > 0 and target_weight_kg < 500),
  target_body_fat_percent numeric(4, 1) check (target_body_fat_percent >= 0 and target_body_fat_percent <= 100),
  target_date             date,
  memo                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. updated_at の自動更新
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists weight_logs_set_updated_at on public.weight_logs;
create trigger weight_logs_set_updated_at
  before update on public.weight_logs
  for each row execute function public.set_updated_at();

drop trigger if exists inbody_logs_set_updated_at on public.inbody_logs;
create trigger inbody_logs_set_updated_at
  before update on public.inbody_logs
  for each row execute function public.set_updated_at();

drop trigger if exists body_goals_set_updated_at on public.body_goals;
create trigger body_goals_set_updated_at
  before update on public.body_goals
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. Row Level Security (RLS)
--    いずれのテーブルも「自分のデータのみ」アクセス可。
-- ------------------------------------------------------------
alter table public.weight_logs enable row level security;
alter table public.inbody_logs enable row level security;
alter table public.body_goals  enable row level security;

-- weight_logs
drop policy if exists "own weight_logs: select" on public.weight_logs;
create policy "own weight_logs: select" on public.weight_logs
  for select using (auth.uid() = user_id);

drop policy if exists "own weight_logs: insert" on public.weight_logs;
create policy "own weight_logs: insert" on public.weight_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own weight_logs: update" on public.weight_logs;
create policy "own weight_logs: update" on public.weight_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own weight_logs: delete" on public.weight_logs;
create policy "own weight_logs: delete" on public.weight_logs
  for delete using (auth.uid() = user_id);

-- inbody_logs
drop policy if exists "own inbody_logs: select" on public.inbody_logs;
create policy "own inbody_logs: select" on public.inbody_logs
  for select using (auth.uid() = user_id);

drop policy if exists "own inbody_logs: insert" on public.inbody_logs;
create policy "own inbody_logs: insert" on public.inbody_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own inbody_logs: update" on public.inbody_logs;
create policy "own inbody_logs: update" on public.inbody_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own inbody_logs: delete" on public.inbody_logs;
create policy "own inbody_logs: delete" on public.inbody_logs
  for delete using (auth.uid() = user_id);

-- body_goals
drop policy if exists "own body_goals: select" on public.body_goals;
create policy "own body_goals: select" on public.body_goals
  for select using (auth.uid() = user_id);

drop policy if exists "own body_goals: insert" on public.body_goals;
create policy "own body_goals: insert" on public.body_goals
  for insert with check (auth.uid() = user_id);

drop policy if exists "own body_goals: update" on public.body_goals;
create policy "own body_goals: update" on public.body_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own body_goals: delete" on public.body_goals;
create policy "own body_goals: delete" on public.body_goals
  for delete using (auth.uid() = user_id);
