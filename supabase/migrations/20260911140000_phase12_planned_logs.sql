-- ============================================================
-- gym-buddy / Phase 12: 「まだやっていない記録」の区別 (is_planned)
--
-- 目的:
--   ルーティンを展開すると、その種目の前回の記録(またはルーティンの目標値)が
--   セットの初期値として入る。これは便利な一方で、画面上は実際に記録した内容と
--   まったく同じ見た目になるため、「もう入力したんだっけ?」と迷う原因になっていた。
--
--   そこで「展開しただけで、まだ実際にやっていない記録」に印を付ける。
--     is_planned = true  … 展開しただけ(中身は前回の値 / ルーティンの目標値)
--     is_planned = false … 実際にやって入力した記録
--
--   画面ではこの印を見て「予定」として薄く出し、数値を直して保存するか
--   「この内容で実施」を押した時点で false にする。
--
-- ★ 既存データを消さない設計です。
--   - 追加するのは列 1 つだけ(add column if not exists)
--   - 既定値は false なので、これまでの記録はすべて「実際にやった記録」のまま
--   - 何度実行しても結果が変わりません(冪等)
--
-- 実行順の前提: Phase 1 → … → Phase 11 → Phase 12
-- ============================================================

alter table public.workout_logs
  add column if not exists is_planned boolean not null default false;

comment on column public.workout_logs.is_planned is
  'true = ルーティンを展開しただけで、まだ実際にやっていない記録(中身は前回の値やルーティンの目標値)。'
  '数値を保存するか「この内容で実施」を押すと false になる。';

-- 「その日の予定がまだ残っているか」を引くための索引。
-- 予定はふつう少数なので、部分索引にして小さく保つ。
create index if not exists workout_logs_planned_idx
  on public.workout_logs (user_id, workout_date)
  where is_planned;
