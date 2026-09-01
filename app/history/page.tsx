"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { WorkoutLogWithExercise } from "@/lib/types";

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${y}年${m}月${d}日(${weekday})`;
}

export default function HistoryPage() {
  const [logs, setLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("workout_logs")
        .select("*, exercises(id, name, muscle_group)")
        .order("workout_date", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) {
        setError(`履歴の取得に失敗しました: ${error.message}`);
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
      <h1 className="mb-4 text-xl font-bold">📅 履歴</h1>

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
                  {dayLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex justify-between text-sm text-gray-700"
                    >
                      <span className="truncate">
                        {log.exercises?.name ?? "(削除された種目)"}
                      </span>
                      <span className="shrink-0 pl-2 text-gray-500">
                        {log.weight_kg}kg × {log.reps}回 × {log.sets}set
                      </span>
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
