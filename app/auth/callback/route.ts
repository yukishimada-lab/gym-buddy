import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth のコールバック。認可コードをセッションに交換してトップへ戻す。
 *
 * GitHub / Google などプロバイダを問わず、この 1 本の経路を共通で使う。
 * Supabase のログイン URL には常に redirectTo=<origin>/auth/callback を渡しており、
 * ここで交換したセッション Cookie が以降のすべての画面(RLS 付きのデータ取得)で使われる。
 *
 * 失敗したときは理由を /login?error=... に載せて戻す。
 * (Google の OAuth 同意画面が「テスト」状態のままで、テストユーザーに
 *  登録されていない人がログインしようとした場合などに出る)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        `ログインに失敗しました: ${error.message}`
      )}`
    );
  }

  // プロバイダ側で拒否された場合は error / error_description が付いて戻ってくる
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        `ログインできませんでした: ${providerError}`
      )}`
    );
  }

  return NextResponse.redirect(`${origin}/login`);
}
