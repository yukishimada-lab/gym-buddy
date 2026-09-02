-- ============================================================
-- gym-buddy / Phase 2: 食事管理と PFC 計算
--
-- 由来: もとの supabase/phase2.sql(現在は supabase/legacy/phase2.sql)
-- 本番 Supabase には適用済みです。
--
-- ★ 冪等・非破壊: DROP TABLE / TRUNCATE / DELETE は含まれていません。
--   食品マスタの初期データは ON CONFLICT DO NOTHING なので、
--   ユーザーが編集した値を上書きすることもありません。
--
-- ※ Phase 1 のテーブルには手を加えません。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 食品マスタ (food_items)
--    100g あたりの PFC・カロリーを持つ食品データベース。
--    user_id が NULL の行は全ユーザー共通のマスタ(下でシード投入)。
--    user_id が入っている行はそのユーザーだけの追加食品(将来拡張用)。
-- ------------------------------------------------------------
create table if not exists public.food_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete cascade,
  name       text not null,
  protein_g  numeric(6, 1) not null default 0 check (protein_g >= 0),  -- タンパク質 (g / 100g)
  fat_g      numeric(6, 1) not null default 0 check (fat_g >= 0),      -- 脂質 (g / 100g)
  carbs_g    numeric(6, 1) not null default 0 check (carbs_g >= 0),    -- 炭水化物 (g / 100g)
  calories   numeric(7, 1) not null default 0 check (calories >= 0),   -- カロリー (kcal / 100g)
  created_at timestamptz not null default now()
);

create index if not exists food_items_user_id_idx on public.food_items (user_id);

-- 共通マスタ(user_id IS NULL)は名前の重複を許さない(再実行時の重複防止)
create unique index if not exists food_items_shared_name_key
  on public.food_items (name) where user_id is null;

-- ------------------------------------------------------------
-- 2. 食事記録 (meal_logs)
--    日付 × 食事タイミング(朝/昼/夜/間食)ごとに食品を記録。
--    PFC・カロリーは「そのグラム数での値」を保存する
--    (食品マスタに無い外食・AI 推定でもそのまま記録できるようにするため)。
-- ------------------------------------------------------------
create table if not exists public.meal_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  meal_date    date not null default current_date,
  meal_type    text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_item_id uuid references public.food_items (id) on delete set null,  -- マスタ由来なら参照(任意)
  food_name    text not null,
  amount_g     numeric(7, 1) check (amount_g >= 0),  -- グラム数(外食など不明な場合は NULL 可)
  protein_g    numeric(6, 1) not null default 0 check (protein_g >= 0),
  fat_g        numeric(6, 1) not null default 0 check (fat_g >= 0),
  carbs_g      numeric(6, 1) not null default 0 check (carbs_g >= 0),
  calories     numeric(7, 1) not null default 0 check (calories >= 0),
  photo_path   text,  -- Supabase Storage (meal-photos) 内のパス(写真から記録した場合)
  created_at   timestamptz not null default now()
);

create index if not exists meal_logs_user_date_idx
  on public.meal_logs (user_id, meal_date desc);

-- ------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ------------------------------------------------------------
alter table public.food_items enable row level security;
alter table public.meal_logs  enable row level security;

-- food_items: 共通マスタ(user_id IS NULL)は誰でも閲覧可。
--             自分で追加した食品は本人のみ閲覧・変更可。
drop policy if exists "food_items: select shared or own" on public.food_items;
create policy "food_items: select shared or own" on public.food_items
  for select using (user_id is null or auth.uid() = user_id);

drop policy if exists "food_items: insert own" on public.food_items;
create policy "food_items: insert own" on public.food_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "food_items: update own" on public.food_items;
create policy "food_items: update own" on public.food_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "food_items: delete own" on public.food_items;
create policy "food_items: delete own" on public.food_items
  for delete using (auth.uid() = user_id);

-- meal_logs: 自分の記録のみアクセス可
drop policy if exists "own meal_logs: select" on public.meal_logs;
create policy "own meal_logs: select" on public.meal_logs
  for select using (auth.uid() = user_id);

drop policy if exists "own meal_logs: insert" on public.meal_logs;
create policy "own meal_logs: insert" on public.meal_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own meal_logs: update" on public.meal_logs;
create policy "own meal_logs: update" on public.meal_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own meal_logs: delete" on public.meal_logs;
create policy "own meal_logs: delete" on public.meal_logs
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. 食品マスタの初期データ(100g あたり・目安値)
--    日本食品標準成分表をもとにした概算値です。
-- ------------------------------------------------------------
insert into public.food_items (user_id, name, protein_g, fat_g, carbs_g, calories)
values
  (null, '白米(ごはん)',            2.5,  0.3, 37.1, 156),
  (null, '玄米ごはん',               2.8,  1.0, 35.6, 152),
  (null, '食パン',                   8.9,  4.1, 46.4, 248),
  (null, 'オートミール',            13.7,  5.7, 69.1, 350),
  (null, 'うどん(ゆで)',           2.6,  0.4, 21.6,  95),
  (null, 'そば(ゆで)',             4.8,  1.0, 26.0, 130),
  (null, 'パスタ(ゆで)',           5.8,  0.9, 30.3, 150),
  (null, 'さつまいも(蒸し)',       1.2,  0.2, 31.9, 131),
  (null, 'じゃがいも',               1.8,  0.1, 17.3,  59),
  (null, '鶏むね肉(皮なし)',      23.3,  1.9,  0.1, 105),
  (null, '鶏もも肉(皮なし)',      19.0,  5.0,  0.0, 113),
  (null, '鶏ささみ',                23.9,  0.8,  0.1,  98),
  (null, '豚ロース',                19.3, 19.2,  0.2, 248),
  (null, '牛もも肉(赤身)',        21.3,  4.3,  0.6, 130),
  (null, '卵(全卵)',              12.2, 10.2,  0.4, 142),
  (null, '納豆',                    16.5, 10.0, 12.1, 190),
  (null, '木綿豆腐',                 7.0,  4.9,  1.5,  73),
  (null, '鮭',                      22.3,  4.1,  0.1, 124),
  (null, 'さば',                    20.6, 16.8,  0.3, 211),
  (null, 'まぐろ(赤身)',          26.4,  1.4,  0.1, 106),
  (null, 'ツナ缶(水煮)',          16.0,  0.7,  0.2,  70),
  (null, 'プロテインパウダー(ホエイ)', 75.0, 7.5, 10.0, 400),
  (null, '牛乳',                     3.3,  3.8,  4.8,  61),
  (null, 'ヨーグルト(無糖)',       3.6,  3.0,  4.9,  56),
  (null, 'ギリシャヨーグルト(無脂肪)', 10.0, 0.0, 4.0,  59),
  (null, 'ブロッコリー',             5.4,  0.6,  6.6,  37),
  (null, 'ほうれん草',               2.2,  0.4,  3.1,  18),
  (null, 'トマト',                   0.7,  0.1,  4.7,  20),
  (null, 'バナナ',                   1.1,  0.2, 22.5,  93),
  (null, 'アーモンド',              20.3, 51.8, 20.9, 608)
on conflict (name) where user_id is null do nothing;

-- ------------------------------------------------------------
-- 5. 食事写真用の Storage バケット (meal-photos) と RLS ポリシー
--    ユーザーは自分のフォルダ(<user_id>/...)のみ読み書き可。
--
--    storage.objects は supabase_storage_admin が所有しているため、
--    CI(postgres ロール)から実行すると権限エラーになる環境があります。
--    マイグレーション全体が止まらないよう、権限が無い場合は
--    NOTICE を出してスキップし、Supabase ダッシュボードの
--    Storage → Policies から設定できるようにしています。
--    (本番ではダッシュボード経由で設定済みです)
-- ------------------------------------------------------------
do $storage$
begin
  insert into storage.buckets (id, name, public)
  values ('meal-photos', 'meal-photos', false)
  on conflict (id) do nothing;

  execute $ddl$ drop policy if exists "meal-photos: select own" on storage.objects $ddl$;
  execute $ddl$
    create policy "meal-photos: select own" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'meal-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $ddl$;

  execute $ddl$ drop policy if exists "meal-photos: insert own" on storage.objects $ddl$;
  execute $ddl$
    create policy "meal-photos: insert own" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'meal-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $ddl$;

  execute $ddl$ drop policy if exists "meal-photos: update own" on storage.objects $ddl$;
  execute $ddl$
    create policy "meal-photos: update own" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'meal-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $ddl$;

  execute $ddl$ drop policy if exists "meal-photos: delete own" on storage.objects $ddl$;
  execute $ddl$
    create policy "meal-photos: delete own" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'meal-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $ddl$;
exception
  when insufficient_privilege or undefined_table then
    raise notice 'meal-photos バケット / storage のポリシー設定をスキップしました(権限不足)。Supabase ダッシュボードの Storage から設定してください。';
end
$storage$;
