"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

/**
 * 種目カードの中から「もう 1 セット」をその場で足す欄。
 *
 * これまで 2 セット目以降を入れるには
 * 「編集 → セットを追加 → 入っている数字を消して打ち直す → 保存」の 4 手が必要だった。
 * セットをこなすたびにこれをやるのは現実的ではないので、
 * カードの中に「重量 × 回数 → 記録」だけの行を置いている。
 *
 * - 初期値は直前のセット(同じ重量で続けることが多いため)
 * - 数値の欄は触ると全選択されるので、打ち直すときも消す操作が要らない
 * - 「記録」を押した時点で保存され、休憩タイマーもそこから始まる
 */
export default function QuickSetAdd({
  idPrefix,
  exerciseName,
  setNumber,
  defaultWeight,
  defaultReps,
  onAdd,
  disabled = false,
}: {
  /** ページ内で input の id が衝突しないようにするための接頭辞 */
  idPrefix: string;
  exerciseName: string;
  /** これから足すセットが何セット目か */
  setNumber: number;
  defaultWeight: string;
  defaultReps: string;
  onAdd: (weight: string, reps: string) => void;
  disabled?: boolean;
}) {
  const [weight, setWeight] = useState(defaultWeight);
  const [reps, setReps] = useState(defaultReps);

  const submit = () => {
    if (disabled) return;
    onAdd(weight, reps);
  };

  /** Enter でも記録できるようにする(スマホのキーボードの「完了」でも動く) */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const selectAll = (e: React.FocusEvent<HTMLInputElement>) =>
    e.currentTarget.select();

  return (
    /*
      画面が狭いと数値の欄が潰れて読めなくなるので、
      入力欄のかたまりには下限の幅を持たせ、入りきらないときは
      「記録」ボタンだけを次の行に送る(折り返し)。
    */
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-blue-50 p-1.5">
      <span
        aria-hidden
        className="w-9 shrink-0 text-center text-xs font-semibold tabular-nums text-blue-700"
      >
        {setNumber}set
      </span>

      <div className="flex min-w-[10rem] flex-1 items-center gap-1">
        <label htmlFor={`${idPrefix}-quick-weight`} className="sr-only">
          {exerciseName} {setNumber}セット目の重量(kg)
        </label>
        <input
          id={`${idPrefix}-quick-weight`}
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          placeholder="60"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onFocus={selectAll}
          onKeyDown={onKeyDown}
          className="w-0 min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-1 py-2 text-center"
        />
        <span aria-hidden className="shrink-0 text-xs text-gray-500">
          kg ×
        </span>

        <label htmlFor={`${idPrefix}-quick-reps`} className="sr-only">
          {exerciseName} {setNumber}セット目の回数
        </label>
        <input
          id={`${idPrefix}-quick-reps`}
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="10"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          onFocus={selectAll}
          onKeyDown={onKeyDown}
          className="w-0 min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-1 py-2 text-center"
        />
        <span aria-hidden className="shrink-0 text-xs text-gray-500">
          回
        </span>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        aria-label={`${exerciseName}に${setNumber}セット目を記録`}
        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
      >
        <Plus aria-hidden size={14} />
        記録
      </button>
    </div>
  );
}
