# supabase/legacy — 旧 SQL ファイル(実行不要・参照用)

このフォルダのファイルは、**Supabase の SQL Editor に手でコピペして実行していた頃の SQL** です。

現在は [`supabase/migrations/`](../migrations) の Supabase CLI マイグレーションに再編成され、
main ブランチへのプッシュで GitHub Actions が自動適用します。
**このフォルダのファイルを実行する必要はありません。**

| 旧ファイル | 対応するマイグレーション |
| --- | --- |
| `schema.sql` | `20260901035412_phase1_initial_schema.sql` |
| `phase2.sql` | `20260901130705_phase2_meals_and_pfc.sql` |
| `phase3.sql` | `20260901164549_phase3_body_and_goals.sql` |
| `phase4.sql` | `20260901185522_phase4_workout_sets_and_body_logs.sql` |
| `phase5.sql` | `20260902093753_phase5_muscle_groups_and_weight_fix.sql` |

移行にあたって加えた変更は次の 2 点だけで、SQL の中身(作成されるテーブル・ポリシー・関数)は同じです。

- **Phase 2**: Storage(`meal-photos` バケットとそのポリシー)の設定を、権限が無い環境では
  スキップして続行するようにしました。CI の実行ユーザーでは `storage.objects` を変更できない
  ことがあり、そこでマイグレーション全体が止まるのを避けるためです。
- **Phase 4**: 一度きりのデータ移行(旧 `workout_logs` → `workout_sets`、
  `weight_logs` / `inbody_logs` → `body_logs`)に「移行先がまだ空のときだけ実行する」という
  ガードを追加しました。万一再実行されても、あとから削除した記録が復活したり、
  編集した値が書き戻されたりしないようにするためです。

ファイル先頭の診断用クエリ(`phase5.sql`)など、参照する価値のあるコメントが残っているため、
削除せずここに残しています。
