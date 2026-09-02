-- ============================================================
-- gym-buddy / Phase 8: 種目ごとのメモ(日付 × 種目)
--
-- 記録画面の各種目に、その日の自由記述メモを残せるようにする。
--   例:「フォームを意識」「肘が痛かったので軽め」「次回は +2.5kg」
--
-- メモは workout_logs(日付 × 種目 で 1 行)に持たせる。
-- workout_logs.memo は Phase 1 の初期スキーマから存在するカラムだが、
-- 「アプリが使うカラムはマイグレーションで明示されている」状態にしたいので、
-- ここで冪等に存在を保証し、用途をコメントとして残しておく。
--
-- ★ 既存データを消さない設計です。
--   - DROP TABLE / TRUNCATE / DELETE は 1 つも含まれていません
--   - 追加は ALTER TABLE ... ADD COLUMN IF NOT EXISTS のみ
--     (すでに列がある本番では何も起きません。メモの中身も消えません)
--   - 何度実行しても結果が変わりません(冪等)
--
-- 実行順の前提: Phase 1 → … → Phase 7 → Phase 8
-- ============================================================

-- ------------------------------------------------------------
-- 1. メモ用のカラム(日付 × 種目 = workout_logs 1 行に 1 つ)
-- ------------------------------------------------------------
alter table public.workout_logs
  add column if not exists memo text;

comment on column public.workout_logs.memo is
  'その日のその種目に対する自由記述メモ(例: フォームを意識 / 次回は +2.5kg)。空文字は保存せず NULL にする。';

-- ------------------------------------------------------------
-- 2. 「前回のメモ」を引くためのインデックス
--    種目ごとに日付の新しい順でメモを 1 件だけ探す用途。
-- ------------------------------------------------------------
create index if not exists workout_logs_memo_lookup_idx
  on public.workout_logs (user_id, exercise_id, workout_date desc)
  where memo is not null;

-- ------------------------------------------------------------
-- 3. RLS の確認(Phase 1 と同じ内容を貼り直しておく)
--
--    メモの追加・編集・削除は workout_logs の UPDATE で行うため、
--    自分の記録だけを読み書きできる状態になっていることを保証する。
--    drop policy if exists → create policy なので何度実行しても同じ。
-- ------------------------------------------------------------
alter table public.workout_logs enable row level security;

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

-- ------------------------------------------------------------
-- 4. 空文字のメモを NULL にそろえる
--    (「メモあり」の判定を memo is not null だけで済ませるため。
--      文字が入っているメモには一切触れません)
-- ------------------------------------------------------------
update public.workout_logs
   set memo = null
 where memo is not null
   and btrim(memo) = '';
