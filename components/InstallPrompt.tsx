"use client";

import { useEffect, useState } from "react";

/** 「今後表示しない」を押したかどうかを覚えておくキー */
const DISMISS_KEY = "gym-buddy:install-prompt-dismissed";
/** 案内を出すまでの待ち時間(開いてすぐ被せると邪魔なので少し待つ) */
const SHOW_DELAY_MS = 2500;

/** Chrome などが投げる beforeinstallprompt イベント(型定義が無いので最小限だけ) */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** ホーム画面から起動している(= すでにインストール済み)か */
function isStandalone() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    iosStandalone === true
  );
}

/** iPhone / iPad かどうか(iPadOS は Macintosh を名乗るのでタッチ数でも判定する) */
function isIos() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

/** iOS の共有ボタン(□に↑)のアイコン */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 3.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m8.5 7 3.5-3.5L15.5 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10.5h-2v10h13v-10h-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 「ホーム画面に追加」の項目に出るアイコン(□に+) */
function AddToHomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 8.5v7M8.5 12h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 「ホーム画面に追加するとアプリのように使えます」の案内。
 *
 * - すでに standalone(ホーム画面から起動)なら何も出さない
 * - iOS は共有ボタンからの手順を図解つきで案内する
 * - Android / デスクトップ Chrome は beforeinstallprompt を使って
 *   ボタン 1 つでインストールできるようにする
 * - 「今後表示しない」で localStorage に記録して二度と出さない
 *
 * hasBottomNav にはボトムナビを表示中かどうかを渡す。
 * 表示中はナビに被らないよう、その高さぶん上にずらす。
 */
export default function InstallPrompt({
  hasBottomNav = false,
}: {
  hasBottomNav?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  // visible は必ずマウント後に true になるので、ここで window を見ても
  // サーバー描画との食い違い(ハイドレーションエラー)にはならない
  const ios = visible && isIos();

  useEffect(() => {
    if (isStandalone()) return;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // プライベートモードなどで localStorage が使えないときは案内を出す
    }
    if (dismissed) return;

    const onBeforeInstallPrompt = (event: Event) => {
      // Chrome の既定のミニバーを止めて、自前の案内から出す
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => setVisible(false);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const close = () => setVisible(false);

  const closeForever = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 保存できなくても閉じる動作だけは行う
    }
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  // iOS 以外で beforeinstallprompt も来ていない場合は案内する手段がないので出さない
  if (!ios && !deferred) return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md px-4 ${
        hasBottomNav
          ? "pb-[calc(env(safe-area-inset-bottom)+4.5rem)]"
          : "pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      }`}
      role="dialog"
      aria-label="ホーム画面に追加のご案内"
    >
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt=""
            className="h-11 w-11 shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="font-bold">ホーム画面に追加できます</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              追加すると、アドレスバーのない全画面でアプリのように使えます。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-gray-400 active:bg-gray-100"
          >
            ×
          </button>
        </div>

        {ios ? (
          <ol className="mt-3 space-y-2 text-xs leading-relaxed text-gray-700">
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                1
              </span>
              <span className="flex flex-wrap items-center gap-1">
                画面下の
                <ShareIcon className="h-5 w-5 text-blue-600" />
                <span className="font-semibold">共有ボタン</span>
                をタップ
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                2
              </span>
              <span className="flex flex-wrap items-center gap-1">
                メニューを下にスクロールして
                <AddToHomeIcon className="h-4 w-4 text-blue-600" />
                <span className="font-semibold">「ホーム画面に追加」</span>
                をタップ
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                3
              </span>
              <span>
                右上の<span className="font-semibold">「追加」</span>をタップして完了
              </span>
            </li>
          </ol>
        ) : (
          <button
            type="button"
            onClick={install}
            className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white active:opacity-80"
          >
            ホーム画面に追加
          </button>
        )}

        <div className="mt-3 flex justify-end gap-4 text-xs">
          <button
            type="button"
            onClick={closeForever}
            className="text-gray-500 underline underline-offset-2"
          >
            今後表示しない
          </button>
          <button type="button" onClick={close} className="font-semibold text-gray-700">
            あとで
          </button>
        </div>
      </div>
    </div>
  );
}
