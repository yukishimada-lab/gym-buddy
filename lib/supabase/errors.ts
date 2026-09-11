/**
 * Supabase から返るエラーの判定。
 */

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
} | null;

/**
 * 「その列がまだ無い」エラーか。
 *
 * アプリのコードは main へのプッシュで即座に本番へ出るが、DB の
 * マイグレーションは別のワークフローで適用される。シークレットの期限切れなどで
 * マイグレーションだけが失敗すると、「新しい列を使うコードだけが本番にいる」
 * 状態になり、その列を使う操作が丸ごと失敗してしまう。
 *
 * そこでこの判定を使い、列がまだ無いときは列を使わない形でやり直す。
 * マイグレーションが適用されれば、何もしなくても本来の動きに戻る。
 *
 * - 42703 … PostgreSQL の undefined_column
 * - PGRST204 … PostgREST のスキーマキャッシュに列が見つからない
 */
export function isMissingColumnError(error: SupabaseLikeError): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;

  const message = (error.message ?? "").toLowerCase();
  if (message.includes("schema cache")) return true;
  return message.includes("column") && message.includes("does not exist");
}
