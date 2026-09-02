"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import BottomNav from "@/components/BottomNav";
import InstallPrompt from "@/components/InstallPrompt";

/**
 * 全ページ共通のシェル。
 * - Supabase 未設定ならセットアップ案内を表示
 * - 未ログインなら /login へリダイレクト
 * - ログイン済みなら下部ナビゲーションを表示
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  // 未設定時はフェッチしないので最初からロード完了扱いにする
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const isPublicPath =
    pathname === "/login" || pathname.startsWith("/auth");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(({ data }) => {
        setUser(data.user ?? null);
        setLoading(false);
      })
      // オフラインなどで問い合わせ自体が失敗しても、
      // 「読み込み中...」のまま固まらないようにする。
      // 実際のログイン状態は下の onAuthStateChange が拾い直す。
      .catch(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading || !isSupabaseConfigured) return;
    if (!user && !isPublicPath) {
      router.replace("/login");
    } else if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [loading, user, isPublicPath, pathname, router]);

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-xl font-bold">gym-buddy のセットアップ</h1>
        <p className="text-sm leading-relaxed">
          Supabase の環境変数が設定されていません。
          <code className="mx-1 rounded bg-gray-200 px-1">.env.local</code>
          に以下を設定してから再起動してください。
        </p>
        <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
          {"NEXT_PUBLIC_SUPABASE_URL=...\nNEXT_PUBLIC_SUPABASE_ANON_KEY=..."}
        </pre>
        <p className="text-sm text-gray-600">
          手順の詳細は README.md を参照してください。
        </p>
      </main>
    );
  }

  if (loading || (!user && !isPublicPath)) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-gray-500">読み込み中...</p>
      </main>
    );
  }

  const showBottomNav = Boolean(user) && !isPublicPath;

  return (
    // ノッチ側(上・左右)はここでまとめて避ける。
    // 下側はボトムナビと各画面の固定要素が個別に env(safe-area-inset-bottom) を見ている。
    <div className="mx-auto min-h-dvh max-w-md pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div
        className={
          showBottomNav ? "pb-[calc(env(safe-area-inset-bottom)+5rem)]" : ""
        }
      >
        {children}
      </div>
      {showBottomNav && <BottomNav />}
      <InstallPrompt hasBottomNav={showBottomNav} />
    </div>
  );
}
