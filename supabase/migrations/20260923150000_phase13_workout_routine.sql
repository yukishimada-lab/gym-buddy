-- ============================================================
-- gym-buddy / Phase 13: 記録がどのルーティンから来たかを残す (routine_id)
--
-- 目的:
--   カレンダーや日別詳細で「この日は何の日(胸の日 / 脚の日)だったか」を
--   すぐ分かるようにする。これまでは記録とルーティンの結びつきを
--   どこにも残していなかったため、あとから辿れなかった。
--
--   ルーティンを展開したときだけ入る。手で 1 種目ずつ追加した記録は NULL。
--   ルーティンを消しても記録は残したいので on delete set null にしている。
--
-- ★ 既存データを消さない設計です。
--   - 追加するのは列 1 つだけ(add column if not exists)
--   - 既存の記録はすべて NULL(= ルーティン不明)のまま
--   - 何度実行しても結果が変わりません(冪等)
--
-- 実行順の前提: Phase 1 → … → Phase 12 → Phase 13
-- ============================================================

alter table public.workout_logs
  add column if not exists routine_id uuid references public.routines (id) on delete set null;

comment on column public.workout_logs.routine_id is
  'この記録がどのルーティンを展開して作られたか(任意)。'
  '手で追加した記録は NULL。ルーティンを削除しても記録は残す(on delete set null)。';

-- 「この日はどのルーティンだったか」を引くための索引。
-- ルーティン由来の記録だけを対象にする部分索引。
create index if not exists workout_logs_routine_idx
  on public.workout_logs (user_id, workout_date, routine_id)
  where routine_id is not null;
