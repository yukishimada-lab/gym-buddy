"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  ALL_GROUPS,
  exerciseGroup,
  filterExercises,
  groupCounts,
} from "@/lib/exerciseFilter";
import type { Exercise } from "@/lib/types";

/**
 * 種目を選ぶための入力。
 *
 * 以前は全種目が 1 つのプルダウンに並んでいて、種目が増えるほど探しにくかった。
 * ここでは「部位で絞る」「名前で探す」の 2 つで候補を減らしてから選ぶ。
 *
 * 選んだあとは一覧をたたんで「選択中」だけを出す。
 * 入力フォームが縦に長くなって「追加する」ボタンが押しにくくなるのを防ぐため。
 */
type Props = {
  exercises: Exercise[];
  /** 選択中の種目 id(未選択は空文字) */
  value: string;
  onChange: (exerciseId: string) => void;
};

export default function ExercisePicker({ exercises, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>(ALL_GROUPS);
  /** 選択済みでも一覧を開いている状態(種目を変えたいとき) */
  const [changing, setChanging] = useState(false);

  const selected = exercises.find((exercise) => exercise.id === value) ?? null;
  const groups = useMemo(() => groupCounts(exercises), [exercises]);
  const filtered = useMemo(
    () => filterExercises(exercises, { group, query }),
    [exercises, group, query]
  );

  function select(exerciseId: string) {
    onChange(exerciseId);
    setQuery("");
    setChanging(false);
  }

  // 選択済み:「選択中の種目」だけを出して一覧はたたむ
  if (selected && !changing) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
        <Check aria-hidden size={16} className="shrink-0 text-blue-600" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">
          <span className="mr-1 rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
            {exerciseGroup(selected)}
          </span>
          {selected.name}
        </span>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 active:bg-gray-100"
        >
          変更
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3">
      {/* 名前で探す */}
      <div className="relative mb-2">
        <Search
          aria-hidden
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="種目を検索(例: ベンチ)"
          aria-label="種目を検索"
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-9 text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="検索をクリア"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 active:bg-gray-100"
          >
            <X aria-hidden size={16} />
          </button>
        )}
      </div>

      {/* 部位で絞る(種目がある部位だけ出す) */}
      {groups.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <GroupChip
            label="すべて"
            count={exercises.length}
            active={group === ALL_GROUPS}
            onClick={() => setGroup(ALL_GROUPS)}
          />
          {groups.map((entry) => (
            <GroupChip
              key={entry.group}
              label={entry.group}
              count={entry.count}
              active={group === entry.group}
              onClick={() =>
                setGroup(group === entry.group ? ALL_GROUPS : entry.group)
              }
            />
          ))}
        </div>
      )}

      {/* 候補 */}
      <ul className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        {filtered.length === 0 ? (
          <li className="px-3 py-3 text-sm text-gray-400">
            該当する種目がありません(「種目」タブで登録できます)
          </li>
        ) : (
          filtered.map((exercise) => (
            <li key={exercise.id} className="border-b border-gray-100 last:border-b-0">
              <button
                type="button"
                onClick={() => select(exercise.id)}
                aria-pressed={exercise.id === value}
                // 部位バッジと種目名が「胸ベンチプレス」と続けて読み上げられないよう、
                // 読み上げ用の名前は明示的に区切っておく
                aria-label={`${exerciseGroup(exercise)} ${exercise.name}`}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm active:bg-gray-50 ${
                  exercise.id === value ? "bg-blue-50 font-semibold" : ""
                }`}
              >
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                  {exerciseGroup(exercise)}
                </span>
                <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
              </button>
            </li>
          ))
        )}
      </ul>

      {selected && (
        <button
          type="button"
          onClick={() => setChanging(false)}
          className="mt-2 w-full rounded-lg border border-gray-300 py-2 text-xs font-semibold text-gray-600 active:bg-gray-100"
        >
          キャンセル(「{selected.name}」のまま)
        </button>
      )}
    </div>
  );
}

function GroupChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} ${count}件`}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 active:bg-gray-200"
      }`}
    >
      {label}
      <span className={active ? "ml-1 text-blue-100" : "ml-1 text-gray-400"}>
        {count}
      </span>
    </button>
  );
}
