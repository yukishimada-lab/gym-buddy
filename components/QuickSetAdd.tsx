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
 * - 記録済みのセットと見間違えないよう、破線の枠と「次のセット」の見出しを付ける
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
      「記録済みのセット」と見間違えないようにしている。

      以前は塗りつぶしの箱に「4set 105kg × 10回」と並べていたが、
      これは上の記録一覧とまったく同じ書式なので、
      まだやっていない 4 セット目が入っているように見えてしまった。

      そこで、
        - 枠を破線にする(これから埋める欄だと分かる形)
        - 「次のセット」と言葉でも書く
        - 記録一覧と同じ「4set」の並びを、数値の横から外す
      の 3 つで区別している。色だけに意味を持たせていない。
    */
    <div className="mt-2 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/60 p-2">
      <p className="mb-1.5 text-[11px] font-semibold text-blue-700">
        次のセット({setNumber}set目)
      </p>

      {/*
        狭い画面だと数値が切れて読めなくなるので、
        入力欄のかたまりには下限の幅を持たせ、
        入りきらないときは「記録」だけを次の行に送る。
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex min-w-[9rem] flex-1 items-center gap-1">
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
    </div>
  );
}
