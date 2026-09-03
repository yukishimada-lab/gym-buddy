"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import type { TourId } from "@/lib/tour/types";

/**
 * 各ページのヘッダーに置く「?」ボタン。
 *
 * 押すと、その画面の UI をスポットライトで指しながら順番に説明するツアーが始まる。
 * ツアー本体(driver.js)は押されたときに初めて読み込む(初回表示を重くしないため)。
 *
 * 初めてアプリを開いた人には、記録画面で自動的に案内を出す(1 回だけ)。
 */

/** 初回の自動案内を出したかどうか(端末ごとに覚えておくだけ) */
const WELCOME_KEY = "gym-buddy.tour.welcomed";

function alreadyWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    // プライベートブラウズなどで読めないときは、しつこく出さない方を選ぶ
    return true;
  }
}

function rememberWelcomed() {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    // 覚えられなくてもツアー自体は動くので何もしない
  }
}

export default function HelpButton({
  tour,
  autoStart = false,
}: {
  tour: TourId;
  /**
   * 初回だけ自動で案内を出してよい状態か(記録画面の読み込みが終わったら true)。
   * 読み込み中に始めるとハイライト対象がまだ無いので、ページ側から知らせてもらう。
   */
  autoStart?: boolean;
}) {
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const start = useCallback(() => {
    // 押してから読み込むので、失敗しても画面は壊さない
    import("@/lib/tour/start")
      .then(({ startTour }) => startTour(tour))
      .catch(() => {});
  }, [tour]);

  useEffect(() => {
    if (!autoStart || alreadyWelcomed()) return;
    // 画面の描画が落ち着いてから出す
    const timer = window.setTimeout(() => setWelcomeOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [autoStart]);

  const closeWelcome = (startNow: boolean) => {
    rememberWelcomed();
    setWelcomeOpen(false);
    if (startNow) start();
  };

  return (
    <>
      <button
        type="button"
        data-tour="help-button"
        onClick={start}
        aria-label="使い方ガイドを見る"
        title="使い方ガイド"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 active:bg-blue-100"
      >
        <HelpCircle aria-hidden size={20} strokeWidth={2} />
      </button>

      {welcomeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-welcome-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        >
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="tour-welcome-title" className="text-base font-bold">
              gym-buddy へようこそ
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              画面を指しながら使い方を順番に案内します(1 分ほどです)。
            </p>
            <button
              type="button"
              onClick={() => closeWelcome(true)}
              className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80"
            >
              使い方を見る
            </button>
            <button
              type="button"
              onClick={() => closeWelcome(false)}
              className="mt-2 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-600 active:bg-gray-200"
            >
              スキップ(今後表示しない)
            </button>
            <p className="mt-3 text-center text-xs text-gray-400">
              あとからでも各画面の「?」でいつでも見られます
            </p>
          </div>
        </div>
      )}
    </>
  );
}
