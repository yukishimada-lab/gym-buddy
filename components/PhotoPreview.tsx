"use client";

import { useEffect, useState } from "react";
import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";

/**
 * AI が読み取った写真をその場で見返すためのプレビュー。
 *
 * 自動入力された数値が合っているかを確かめるとき、
 * 写真アプリに切り替えなくても同じ画面で確認できるようにする。
 * サムネイルをタップすると全画面表示になり、
 * 成分表示の細かい文字も「拡大」で読めるようにしている。
 * 写真が差し替わったときは呼び出し側で key={url} を渡して作り直す。
 */
type Props = {
  /** 表示する画像の URL(object URL でも data URL でも可) */
  url: string;
  /** サムネイル横に出す見出し(例: 「解析した写真」) */
  title: string;
  /** 見出しの下に出す補足 */
  hint?: string;
  className?: string;
};

export default function PhotoPreview({ url, title, hint, className }: Props) {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // PC で開いたときに Esc で閉じられるように
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className={`rounded-lg bg-gray-50 p-2 ${className ?? ""}`}>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`${title}を拡大表示`}
            className="relative shrink-0 active:opacity-80"
          >
            {/* AI に送ったのと同じ画像をそのまま出す(next/image は object URL を扱えないため img を使う) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={title}
              className="h-20 w-20 rounded-lg border border-gray-200 bg-white object-cover"
            />
            <span className="absolute right-1 bottom-1 rounded bg-black/55 p-1 text-white">
              <Maximize2 aria-hidden size={12} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-600">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
              {hint ?? "タップすると拡大できます。"}
            </p>
          </div>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
        >
          {/* AppShell の外に出る固定要素なので、ノッチ・ホームバーは自前で避ける */}
          <div className="flex shrink-0 items-center justify-between p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <button
              type="button"
              onClick={() => setZoomed((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-white active:opacity-80"
            >
              {zoomed ? (
                <>
                  <ZoomOut aria-hidden size={16} />
                  全体を表示
                </>
              ) : (
                <>
                  <ZoomIn aria-hidden size={16} />
                  拡大する
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="閉じる"
              className="rounded-lg bg-white/15 p-2 text-white active:opacity-80"
            >
              <X aria-hidden size={18} />
            </button>
          </div>

          {/* 拡大中は横にもスクロールして読めるようにする(iOS Safari でも指でなぞれる)。
              写真の外側をタップすれば閉じ、写真をタップすれば拡大を切り替えられる。 */}
          <div
            className="min-h-0 flex-1 overflow-auto p-3"
            onClick={() => setOpen(false)}
          >
            {zoomed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={title}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomed(false);
                }}
                className="w-[220%] max-w-none rounded-lg"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={title}
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomed(true);
                  }}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </div>
            )}
          </div>

          <p className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center text-xs leading-relaxed text-white/70">
            数値が合っているか、この写真と見比べて確認してください
          </p>
        </div>
      )}
    </>
  );
}
