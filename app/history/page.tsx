"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDateLabel } from "@/lib/date";
import { formatSets, sortLogs, sortSets, summaryLine } from "@/lib/workoutStats";
import { normalizeMuscleGroup } from "@/lib/muscleGroups";
import type { WorkoutLogWithExercise } from "@/lib/types";

export default function HistoryPage() {
  const [logs, setLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error: loadError } = await supabase
        .from("workout_logs")
        .select("*, exercises(id, name, muscle_group), workout_sets(*)")
        .order("workout_date", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(500);
      if (loadError) {
        setError(`履歴の取得に失敗しました: ${loadError.message}`);
      } else {
        setLogs((data as WorkoutLogWithExercise[]) ?? []);
      }
      setLoading(false);
    })();
  }, []);

  // 日付ごとにグループ化(取得時点で日付降順)
  const grouped = logs.reduce<Map<string, WorkoutLogWithExercise[]>>(
    (map, log) => {
      const list = map.get(log.workout_date) ?? [];
      list.push(log);
      map.set(log.workout_date, list);
      return map;
    },
    new Map()
  );

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">📖 履歴</h1>
        <Link
          href="/calendar"
          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-200"
        >
          カレンダーで見る ›
        </Link>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
      ) : grouped.size === 0 ? (
        <p className="rounded-xl bg-white py-8 text-center text-sm text-gray-400 shadow-sm">
          まだ記録がありません。
          <br />
          「記録」タブから最初のワークアウトを記録しましょう!
        </p>
      ) : (
        <ul className="space-y-3">
          {[...grouped.entries()].map(([date, dayLogs]) => (
            <li key={date} className="rounded-xl bg-white p-3 shadow-sm">
              <Link href={`/?date=${date}`} className="block">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-bold">{formatDateLabel(date)}</p>
                  <span className="text-xs text-blue-600">開く ›</span>
                </div>
                <ul className="space-y-1">
                  {sortLogs(dayLogs).map((log) => (
                    <li key={log.id} className="text-sm">
                      <p className="flex items-center gap-1.5 truncate text-gray-700">
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                          {normalizeMuscleGroup(
                            log.exercises?.muscle_group,
                            log.exercises?.name ?? undefined
                          )}
                        </span>
                        <span className="truncate">
                          {log.exercises?.name ?? "(削除された種目)"}
                        </span>
                      </p>
                      <p className="truncate text-xs tabular-nums text-gray-500">
                        {formatSets(sortSets(log.workout_sets ?? []))}
                      </p>
                      <p className="truncate text-xs tabular-nums text-gray-400">
                        {summaryLine(sortSets(log.workout_sets ?? []))}
                      </p>
                    </li>
                  ))}
                </ul>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
