"use client";

import type { SetInput } from "@/lib/types";
import { Plus, X } from "lucide-react";
import { totalVolume } from "@/lib/workoutStats";

/**
 * セットごとの「重量 × 回数」を入力する欄。
 * 記録の追加フォームと編集フォームの両方から使う。
 *
 * 実際のトレーニングは「1セット目 80kg×10回 / 2セット目 80kg×8回 / 3セット目 70kg×8回」
 * のようにセットごとに数値が変わるので、セット単位で入力できるようにしている。
 * セットを追加すると直前のセットの値が初期値として入る(同じ重量で続けることが多いため)。
 */

export function emptySet(): SetInput {
  return { id: null, weight_kg: "", reps: "10" };
}

/** 直前のセットを引き継いだ新しいセット */
export function nextSet(sets: SetInput[]): SetInput {
  const last = sets[sets.length - 1];
  if (!last) return emptySet();
  return { id: null, weight_kg: last.weight_kg, reps: last.reps };
}

export default function SetInputList({
  sets,
  onChange,
  idPrefix,
}: {
  sets: SetInput[];
  onChange: (sets: SetInput[]) => void;
  /** ページ内で input の id が衝突しないようにするための接頭辞 */
  idPrefix: string;
}) {
  const update = (index: number, patch: Partial<SetInput>) => {
    onChange(sets.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const remove = (index: number) => {
    onChange(sets.filter((_, i) => i !== index));
  };

  const volume = totalVolume(sets);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-gray-500">
          セット({sets.length})
        </span>
        {volume > 0 && (
          <span className="text-xs text-gray-500">
            総ボリューム {volume.toLocaleString("ja-JP")}kg
          </span>
        )}
      </div>

      {sets.length === 0 ? (
        <p className="mb-2 rounded-lg bg-gray-50 py-3 text-center text-xs text-gray-500">
          セットがありません。下のボタンから追加してください。
        </p>
      ) : (
        <ul className="mb-2 space-y-1.5">
          {sets.map((set, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <span className="w-9 shrink-0 text-xs tabular-nums text-gray-500">
                {index + 1}set
              </span>
              <label
                htmlFor={`${idPrefix}-weight-${index}`}
                className="sr-only"
              >
                {index + 1}セット目の重量(kg)
              </label>
              <input
                id={`${idPrefix}-weight-${index}`}
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                placeholder="60"
                value={set.weight_kg}
                onChange={(e) => update(index, { weight_kg: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-2 text-center"
              />
              <span aria-hidden className="shrink-0 text-xs text-gray-400">
                kg ×
              </span>
              <label htmlFor={`${idPrefix}-reps-${index}`} className="sr-only">
                {index + 1}セット目の回数
              </label>
              <input
                id={`${idPrefix}-reps-${index}`}
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="10"
                value={set.reps}
                onChange={(e) => update(index, { reps: e.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-2 text-center"
              />
              <span aria-hidden className="shrink-0 text-xs text-gray-400">
                回
              </span>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`${index + 1}セット目を削除`}
                className="shrink-0 rounded-lg px-2 py-2 text-sm text-red-500 active:bg-red-50"
              >
                <X aria-hidden size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onChange([...sets, nextSet(sets)])}
        className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm font-semibold text-gray-600 active:bg-gray-100"
      >
        <span className="inline-flex items-center justify-center gap-1">
          <Plus aria-hidden size={16} />
          セットを追加
        </span>
      </button>
    </div>
  );
}
