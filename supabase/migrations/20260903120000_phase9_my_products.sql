-- ============================================================
-- gym-buddy / Phase 9: マイ商品(成分表示から登録する自分専用の商品)
--
-- 目的:
--   「〇〇社のコーンフレーク」のように、同じ名前でも商品によって
--   栄養成分がまったく違う食品を、ユーザー自身が正確な数値で登録し、
--   食事記録で繰り返し使えるようにする。
--   パッケージ裏の栄養成分表示を写真に撮ると Gemini が数値を読み取り、
--   登録フォームに自動入力する導線を用意している。
--
-- 既存の food_items(共通の食品マスタ・100g あたり固定)とは別テーブルにした理由:
--   - 基準量が「100g あたり」だけでなく「1食あたり」「1個あたり」も要る
--   - メーカー名・メモ・お気に入り・使用回数といった個人向けの属性が要る
--   - 共通マスタ(user_id IS NULL)と権限の考え方が違う(マイ商品は完全に本人専用)
--   food_items を拡張すると共通マスタ側の意味づけが崩れるため、拡張はしない。
--
-- ★ 既存データを消さない設計です。
--   - DROP TABLE / TRUNCATE / DELETE は 1 つも含まれていません
--   - 既存テーブルへの変更は ALTER TABLE ... ADD COLUMN IF NOT EXISTS のみ
--   - 何度実行しても結果が変わりません(冪等)
--
-- 実行順の前提: Phase 1 → … → Phase 8 → Phase 9
-- ============================================================

-- ------------------------------------------------------------
-- 1. マイ商品 (my_products)
--
--    protein_g / fat_g / carbs_g / calories は「basis で示した基準量あたり」の値。
--      basis = 'per_100g'    → 100g あたり
--      basis = 'per_serving' → 1食(1袋・1回分)あたり
--      basis = 'per_piece'   → 1個あたり
--    serving_g は「1食 / 1個が何 g か」(パッケージに書いてあれば入れる。任意)。
--    入っていればグラム指定でも記録できるようになる。
-- ------------------------------------------------------------
create table if not exists public.my_products (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (btrim(name) <> ''),          -- 商品名(例: 〇〇社 コーンフレーク)
  maker        text,                                             -- メーカー名(任意)
  basis        text not null default 'per_100g'
                 check (basis in ('per_100g', 'per_serving', 'per_piece')),
  serving_g    numeric(7, 1) check (serving_g > 0),              -- 1食 / 1個 のグラム数(任意)
  protein_g    numeric(7, 1) not null default 0 check (protein_g >= 0),  -- 基準量あたり タンパク質 (g)
  fat_g        numeric(7, 1) not null default 0 check (fat_g >= 0),      -- 基準量あたり 脂質 (g)
  carbs_g      numeric(7, 1) not null default 0 check (carbs_g >= 0),    -- 基準量あたり 炭水化物 (g)
  calories     numeric(8, 1) not null default 0 check (calories >= 0),   -- 基準量あたり カロリー (kcal)
  memo         text,                                             -- 自由記述(任意)
  is_favorite  boolean not null default false,                   -- お気に入り(一覧の先頭に出す)
  use_count    integer not null default 0 check (use_count >= 0),-- 食事記録で使った回数
  last_used_at timestamptz,                                      -- 最後に使った日時
  photo_path   text,                                             -- 成分表示の写真(Storage: meal-photos 内のパス)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.my_products is
  'ユーザーが自分で登録した商品の栄養成分。パッケージの栄養成分表示をもとに登録し、食事記録で繰り返し使う。';
comment on column public.my_products.basis is
  '栄養成分の基準量。per_100g = 100g あたり / per_serving = 1食あたり / per_piece = 1個あたり';
comment on column public.my_products.serving_g is
  '1食 または 1個 が何グラムか(パッケージに記載があれば)。グラム指定での記録に使う。';

-- 一覧・検索用(本人の商品を名前順に引く)
create index if not exists my_products_user_name_idx
  on public.my_products (user_id, name);

-- よく使う順の並べ替え用(お気に入り → 使用回数 → 最終使用日時)
create index if not exists my_products_user_usage_idx
  on public.my_products (user_id, is_favorite desc, use_count desc, last_used_at desc nulls last);

-- 同じユーザーが「同じメーカー・同じ商品名」を二重登録しないようにする。
-- (メーカー未入力どうしは名前だけで重複判定する)
create unique index if not exists my_products_user_name_maker_key
  on public.my_products (user_id, lower(btrim(name)), lower(coalesce(btrim(maker), '')));

-- ------------------------------------------------------------
-- 2. updated_at の自動更新
--    set_updated_at() は Phase 3 で作成済み。無い環境でも動くよう作り直す。
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

drop trigger if exists my_products_set_updated_at on public.my_products;
create trigger my_products_set_updated_at
  before update on public.my_products
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Row Level Security (RLS)
--    マイ商品は完全に本人専用。共通マスタのような共有行は作らない。
-- ------------------------------------------------------------
alter table public.my_products enable row level security;

drop policy if exists "own my_products: select" on public.my_products;
create policy "own my_products: select" on public.my_products
  for select using (auth.uid() = user_id);

drop policy if exists "own my_products: insert" on public.my_products;
create policy "own my_products: insert" on public.my_products
  for insert with check (auth.uid() = user_id);

drop policy if exists "own my_products: update" on public.my_products;
create policy "own my_products: update" on public.my_products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own my_products: delete" on public.my_products;
create policy "own my_products: delete" on public.my_products
  for delete using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. 食事記録からマイ商品への参照
--    どのマイ商品から記録したかを残す(商品を消しても記録は残す = set null)。
--    既存の food_item_id はそのまま。既存データには NULL が入るだけで影響なし。
-- ------------------------------------------------------------
alter table public.meal_logs
  add column if not exists my_product_id uuid references public.my_products (id) on delete set null;

comment on column public.meal_logs.my_product_id is
  'マイ商品から記録した場合の参照(任意)。商品が削除されても記録自体は残るよう on delete set null。';

create index if not exists meal_logs_my_product_idx
  on public.meal_logs (my_product_id) where my_product_id is not null;

-- ------------------------------------------------------------
-- 5. 「使った」記録を 1 回の呼び出しで更新する関数
--    クライアントから use_count を読んで書き戻すと競合するため、
--    サーバー側で加算する。security invoker なので RLS がそのまま効き、
--    自分の商品しか更新できない(where 句でも user_id を見ている)。
-- ------------------------------------------------------------
create or replace function public.touch_my_product(p_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.my_products
     set use_count    = use_count + 1,
         last_used_at = now()
   where id = p_id
     and user_id = auth.uid();
$$;

grant execute on function public.touch_my_product(uuid) to authenticated;
