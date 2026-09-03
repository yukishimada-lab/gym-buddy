"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Dumbbell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** 対応しているログイン方法(Supabase の OAuth プロバイダ名と同じ) */
type Provider = "google" | "github";

/**
 * コールバック(/auth/callback)で失敗したときは
 * /login?error=... に戻ってくるので、その内容を表示する。
 * useSearchParams は Suspense の内側で使う必要があるため小さく切り出している。
 */
function CallbackError() {
  const message = useSearchParams().get("error");
  if (!message) return null;
  return (
    <p className="max-w-xs text-center text-sm text-red-600">{message}</p>
  );
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  // どのボタンを押したかを覚えておき、押したボタンだけ「接続中…」にする
  const [busy, setBusy] = useState<Provider | null>(null);

  /**
   * OAuth ログインを開始する。
   * プロバイダが違っても戻り先(/auth/callback)は共通で、
   * そこでセッションに交換してからトップページへ戻る。
   */
  const signIn = async (provider: Provider) => {
    setBusy(provider);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(`ログインに失敗しました: ${error.message}`);
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <p className="flex justify-center text-blue-600">
          <Dumbbell aria-hidden size={48} strokeWidth={1.75} />
        </p>
        <h1 className="mt-3 text-3xl font-bold">gym-buddy</h1>
        <p className="mt-2 text-sm text-gray-500">
          ジムでのトレーニングをサクッと記録
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        {/* Google ログイン(Google のブランドガイドラインに沿った白ボタン) */}
        <button
          onClick={() => signIn("google")}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#747775] bg-white px-6 py-3.5 font-semibold text-[#1f1f1f] active:opacity-80 disabled:opacity-50"
        >
          <svg viewBox="0 0 18 18" className="h-5 w-5 shrink-0" aria-hidden>
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          {busy === "google" ? "接続中..." : "Google でログイン"}
        </button>

        {/* GitHub ログイン(従来どおり) */}
        <button
          onClick={() => signIn("github")}
          disabled={busy !== null}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-gray-900 px-6 py-3.5 font-semibold text-white active:opacity-80 disabled:opacity-50"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5 shrink-0 fill-current"
            aria-hidden
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          {busy === "github" ? "接続中..." : "GitHub でログイン"}
        </button>
      </div>

      <p className="max-w-xs text-center text-xs leading-relaxed text-gray-500">
        どちらの方法でログインしても使い方は同じです。
        メールアドレスが同じであれば、記録は同じアカウントに引き継がれます。
      </p>

      {error ? (
        <p className="max-w-xs text-center text-sm text-red-600">{error}</p>
      ) : (
        <Suspense fallback={null}>
          <CallbackError />
        </Suspense>
      )}
    </main>
  );
}
