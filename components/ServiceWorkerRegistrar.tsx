"use client";

import { useEffect } from "react";

/**
 * Service Worker(public/sw.js)を登録するだけのコンポーネント。
 *
 * - 本番ビルドのみで登録する。開発中は Next の HMR と噛み合わないため。
 * - 登録は load 後に行い、初回表示を遅くしない。
 * - 認証のリダイレクト(/auth/callback)を巻き込まないよう、
 *   sw.js 側で /api/ と /auth/ には介入しない作りにしている。
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          // タブを開いたままでも新しいデプロイを拾えるように一度確認する
          registration.update().catch(() => {});
        })
        .catch(() => {
          // 登録に失敗してもアプリ自体は普通に動くので握りつぶす
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
