import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 環境変数が設定されているかどうか(未設定でもビルドが通るようにガードする) */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * ブラウザ用 Supabase クライアントを返す。
 * 環境変数が未設定の場合はプレースホルダで生成する(呼び出し側は
 * isSupabaseConfigured を見て設定画面を出すこと)。
 */
export function createClient() {
  return createBrowserClient(
    supabaseUrl ?? "https://placeholder.supabase.co",
    supabaseAnonKey ?? "placeholder-anon-key"
  );
}
