-- ============================================================
-- gym-buddy / Phase 11: 栄養情報のキャッシュ(nutrition_cache)
--
-- 目的:
--   AI に問い合わせた栄養情報を保存しておき、同じものを 2 回目以降は
--   ネットに出ずに即座に返す。使うほど速く・安く・オフラインに強くなる。
--
--   対象は 2 種類:
--     kind = 'food'       … 一般的な食材・料理(例: 豚バラ / ピザトースト)
--                           数値は「可食部 100g あたり」。food_items と同じ基準。
--     kind = 'restaurant' … 外食チェーンのメニュー(例: 松屋 牛丼特盛)
--                           数値は「そのメニュー 1 食あたり」。100g 換算はしない
--                           (店が公開しているのが 1 食あたりの値のため)。
--
-- なぜ全ユーザー共通(共有)なのか:
--   「豚バラ 100g の栄養価」「松屋の牛丼特盛のカロリー」は誰にとっても同じ値で、
--   個人情報ではない。共有にすると、誰かが一度調べたものは全員が即座に使える。
--   そのぶん書き込みもログイン済みユーザー全員に許可しているので、
--   値の取り直し(再検索して上書き)ができるようにしてある。
--
-- ★ 既存データを消さない設計です。
--   - DROP TABLE / TRUNCATE / DELETE は 1 つも含まれていません
--   - 何度実行しても結果が変わりません(冪等)
--
-- 実行順の前提: Phase 1 → … → Phase 9 → Phase 11
-- ============================================================

-- ------------------------------------------------------------
-- 1. キャッシュ本体
-- ------------------------------------------------------------
create table if not exists public.nutrition_cache (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('food', 'restaurant')),
  -- 検索キー(小文字化・空白の詰めなどを済ませた文字列)。
  -- food なら "豚バラ"、restaurant なら "松屋|牛丼特盛" のように入る。
  cache_key    text not null check (btrim(cache_key) <> ''),
  display_name text not null check (btrim(display_name) <> ''),   -- 画面に出す名前
  protein_g    numeric(7, 1) not null default 0 check (protein_g >= 0),
  fat_g        numeric(7, 1) not null default 0 check (fat_g >= 0),
  carbs_g      numeric(7, 1) not null default 0 check (carbs_g >= 0),
  calories     numeric(8, 1) not null default 0 check (calories >= 0),
  -- 1 人前の目安グラム数。
  --   kind = 'food'       … 料理なら「1 人前は約 200g」の目安(食材なら null)
  --   kind = 'restaurant' … 分かれば 1 食のグラム数(たいてい非公開なので null)
  serving_g    numeric(7, 1) check (serving_g > 0),
  note         text,                                              -- 情報源・注意書き
  source       text not null default 'ai'
                 check (source in ('ai', 'ai_search')),           -- ai_search = 検索して取得
  hit_count    integer not null default 0 check (hit_count >= 0), -- 何回使われたか
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kind, cache_key)
);

comment on table public.nutrition_cache is
  'AI に問い合わせた栄養情報の共有キャッシュ。2 回目以降は再問い合わせせずここから返す。';
comment on column public.nutrition_cache.kind is
  'food = 一般的な食材・料理(100g あたり) / restaurant = 外食メニュー(1 食あたり)';
comment on column public.nutrition_cache.serving_g is
  '1 人前の目安グラム数。food で料理のときに入る(食材や不明なときは NULL)。';

-- よく使われている順に出すため(候補の並べ替え用)
create index if not exists nutrition_cache_kind_usage_idx
  on public.nutrition_cache (kind, hit_count desc, updated_at desc);

-- 前方一致・部分一致で候補を出すため
create index if not exists nutrition_cache_key_idx
  on public.nutrition_cache (kind, cache_key text_pattern_ops);

-- ------------------------------------------------------------
-- 2. updated_at の自動更新(set_updated_at() は Phase 3 で作成済み)
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

drop trigger if exists nutrition_cache_set_updated_at on public.nutrition_cache;
create trigger nutrition_cache_set_updated_at
  before update on public.nutrition_cache
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Row Level Security (RLS)
--    読み取り・書き込みともログイン済みユーザーに許可する(共有キャッシュ)。
--    削除だけは自分が作った行に限る(他人の行を消せないようにするため)。
-- ------------------------------------------------------------
alter table public.nutrition_cache enable row level security;

drop policy if exists "nutrition_cache: select" on public.nutrition_cache;
create policy "nutrition_cache: select" on public.nutrition_cache
  for select to authenticated using (true);

drop policy if exists "nutrition_cache: insert" on public.nutrition_cache;
create policy "nutrition_cache: insert" on public.nutrition_cache
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "nutrition_cache: update" on public.nutrition_cache;
create policy "nutrition_cache: update" on public.nutrition_cache
  for update to authenticated using (true) with check (true);

drop policy if exists "nutrition_cache: delete" on public.nutrition_cache;
create policy "nutrition_cache: delete" on public.nutrition_cache
  for delete to authenticated using (auth.uid() = created_by);

-- ------------------------------------------------------------
-- 4. 「使われた」回数を 1 回の呼び出しで加算する
--    クライアントで読んで書き戻すと同時アクセスで数え落とすため、
--    サーバー側で加算する(my_products の touch_my_product と同じ考え方)。
-- ------------------------------------------------------------
create or replace function public.touch_nutrition_cache(p_id uuid)
returns void
language sql
security invoker
as $$
  update public.nutrition_cache
     set hit_count = hit_count + 1
   where id = p_id;
$$;
