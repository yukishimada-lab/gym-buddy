"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import DaySummaryCard, { CARD_WIDTH } from "@/components/DaySummaryCard";
import { formatDateLabel } from "@/lib/date";
import type { DaySummary } from "@/lib/types";

/**
 * 1 日のサマリーを 1 枚の PNG にして共有するボタン。
 *
 * ■ 画像の作りかた
 * 画面外に置いた DaySummaryCard を html-to-image でそのまま PNG にする
 * (クライアントサイドのみ・サーバーには何も送らない)。
 * iOS Safari は 1 回目の書き出しでフォントの反映が間に合わず崩れることがあるため、
 * 捨てる 1 回目を挟んでから本番の 1 枚を書き出している。
 *
 * ■ 共有の導線(スマホ優先)
 * 1. Web Share API がファイル共有に対応していれば navigator.share で共有シートを出す
 * 2. 非対応 / 共有がエラーになった場合は、画像を画面に出して
 *    「長押しで保存」+「ダウンロード」の両方を用意する
 */

const IMAGE_OPTIONS = {
  pixelRatio: 2,
  backgroundColor: "#ffffff",
  cacheBust: true,
  width: CARD_WIDTH,
} as const;

export default function ShareDaySummary({
  summary,
  disabled,
}: {
  summary: DaySummary;
  /** その日に記録が 1 つも無いときは押せなくする */
  disabled?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileName = `gym-buddy-${summary.date}.png`;

  const render = async (): Promise<string> => {
    const node = cardRef.current;
    if (!node) throw new Error("画像の元になる要素が見つかりませんでした");
    const options = { ...IMAGE_OPTIONS, height: node.scrollHeight };
    // 1 回目は捨てる(iOS Safari でのフォント / レイアウト待ち)
    await toPng(node, options);
    return toPng(node, options);
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await render();

      // Web Share API(ファイル添付)が使えるならそれを最優先にする
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: "image/png" });
        if (
          typeof navigator !== "undefined" &&
          navigator.canShare?.({ files: [file] })
        ) {
          await navigator.share({
            files: [file],
            title: `${formatDateLabel(summary.date)}のトレーニング`,
          });
          setBusy(false);
          return;
        }
      } catch (shareError) {
        // ユーザーが共有シートを閉じただけなら何もしない
        if (
          shareError instanceof DOMException &&
          shareError.name === "AbortError"
        ) {
          setBusy(false);
          return;
        }
        // それ以外(未対応・権限エラー等)は下のフォールバックに進む
      }

      setImageUrl(dataUrl);
    } catch (e) {
      setError(
        `画像の作成に失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`
      );
    }
    setBusy(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={share}
        disabled={disabled || busy}
        className="w-full rounded-lg bg-gray-900 py-2.5 text-center text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        {busy ? "画像を作成中..." : "この日を画像で共有"}
      </button>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* フォールバック: 画像を表示して長押し保存 / ダウンロードしてもらう */}
      {imageUrl && (
        <div
          role="dialog"
          aria-label="共有用の画像"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black/80 p-4"
        >
          <div className="mx-auto w-full max-w-md">
            <p className="mb-2 text-center text-sm text-white">
              画像を長押しすると保存できます
            </p>
            {/* 書き出した PNG をそのまま出す(next/image は data URL を扱えないため img を使う) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`${formatDateLabel(summary.date)}のサマリー画像`}
              className="w-full rounded-xl bg-white"
            />
            <div className="mt-3 flex gap-2 pb-4">
              <a
                href={imageUrl}
                download={fileName}
                className="flex-1 rounded-lg bg-blue-600 py-3 text-center text-sm font-semibold text-white active:opacity-80"
              >
                ダウンロード
              </a>
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="flex-1 rounded-lg bg-white py-3 text-center text-sm font-semibold text-gray-700 active:opacity-80"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        画面外に置いた書き出し用のカード。
        display:none だとレイアウトが確定せず書き出せないので、
        画面の外に追い出したうえで支援技術からは隠す。
      */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: -10000,
          width: CARD_WIDTH,
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        <DaySummaryCard summary={summary} innerRef={cardRef} />
      </div>
    </>
  );
}
