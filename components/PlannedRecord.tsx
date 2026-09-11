"use client";

import { CalendarClock, Check } from "lucide-react";

/**
 * 「まだやっていない予定」の記録を、実際の記録と見分けるための見た目。
 *
 * ルーティンを展開すると、その種目の前回の記録(またはルーティンの目標値)が
 * セットの初期値として入る。便利な一方で、実際に記録した内容とまったく同じ
 * 見た目になるため「もう入力したんだっけ?」と迷う原因になっていた。
 *
 * そこで予定の記録は、
 *   - カードの地と枠線を変える(白いカード → 破線の枠 + 薄い黄色)
 *   - 種目名の横に「予定」の札を付ける
 *   - セットの数値を薄く出す(SetLines の planned)
 *   - 何の値なのかを書き、直す / 確定するボタンを並べる
 * の 4 つで区別する。色だけに意味を持たせないよう、札と文章も必ず添える。
 */

/** 実際に記録したカードの地 */
export const RECORD_CARD_CLASS = "rounded-xl bg-white p-3 shadow-sm";

/** 展開しただけ(予定)のカードの地 */
export const PLANNED_CARD_CLASS =
  "rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-3";

/**
 * カードの先頭に出す「予定」の帯。
 *
 * 種目名の横に置くと、スマホの幅では名前が「スク…」と切れてしまったので、
 * 名前の行とは分けて 1 行取っている。
 */
export function PlannedBadge() {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
        <CalendarClock aria-hidden size={12} />
        予定
      </span>
      <span className="min-w-0 truncate text-[11px] font-semibold text-amber-900">
        まだ実施していません
      </span>
    </div>
  );
}

/**
 * 予定の記録の下に出す案内とボタン。
 *
 * 前回比は「前回と同じ」に決まっていて意味がないので、予定のあいだは出さない
 * (呼び出し側でこのコンポーネントと差し替える)。
 */
export function PlannedNotice({
  previousDateLabel,
  onEdit,
  onConfirm,
  disabled,
}: {
  /** 引き継いだ前回の記録の日付(ルーティンの目標値から入れた場合は null) */
  previousDateLabel: string | null;
  onEdit: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 rounded-lg bg-white/70 p-2">
      <p className="text-xs leading-relaxed text-amber-900">
        {previousDateLabel
          ? `前回(${previousDateLabel})の記録を入れてあります。`
          : "ルーティンの目標値を入れてあります。"}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80"
        >
          数値を入れる
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white py-2 text-sm font-semibold text-gray-700 active:bg-gray-100 disabled:opacity-40"
        >
          <Check aria-hidden size={14} />
          この内容で実施
        </button>
      </div>
    </div>
  );
}
