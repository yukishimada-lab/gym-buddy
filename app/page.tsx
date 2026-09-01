"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  Exercise,
  RoutineWithItems,
  WorkoutLogWithExercise,
} from "@/lib/types";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${y}年${m}月${d}日(${weekday})`;
}

type EditState = {
  id: string;
  weight_kg: string;
  reps: string;
  sets: string;
};

function RecordPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(
    () => searchParams.get("date") ?? todayString()
  );
  const [logs, setLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<RoutineWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("10");
  const [sets, setSets] = useState("3");
  const [saving, setSaving] = useState(false);

  // 編集
  const [edit, setEdit] = useState<EditState | null>(null);

  // ルーティン展開
  const [routineId, setRoutineId] = useState("");
  const [applying, setApplying] = useState(false);

  const loadLogs = useCallback(async (targetDate: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("workout_logs")
      .select("*, exercises(id, name, muscle_group)")
      .eq("workout_date", targetDate)
      .order("created_at", { ascending: true });
    if (error) {
      setError(`記録の取得に失敗しました: ${error.message}`);
    } else {
      setLogs((data as WorkoutLogWithExercise[]) ?? []);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      setLoading(true);
      const [exRes, rtRes] = await Promise.all([
        supabase.from("exercises").select("*").order("name"),
        supabase
          .from("routines")
          .select("*, routine_items(*, exercises(id, name, muscle_group))")
          .order("name"),
      ]);
      if (!exRes.error) setExercises(exRes.data ?? []);
      if (!rtRes.error) setRoutines((rtRes.data as RoutineWithItems[]) ?? []);
      await loadLogs(date);
      setLoading(false);
    })();
    // date 変更時は下の useEffect で再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      await loadLogs(date);
    })();
  }, [date, loadLogs]);

  const addLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exerciseId) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("workout_logs").insert({
      user_id: user.id,
      workout_date: date,
      exercise_id: exerciseId,
      weight_kg: Number(weight) || 0,
      reps: Number(reps) || 0,
      sets: Number(sets) || 0,
    });
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      await loadLogs(date);
    }
    setSaving(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("workout_logs")
      .update({
        weight_kg: Number(edit.weight_kg) || 0,
        reps: Number(edit.reps) || 0,
        sets: Number(edit.sets) || 0,
      })
      .eq("id", edit.id);
    if (error) {
      setError(`更新に失敗しました: ${error.message}`);
    } else {
      setEdit(null);
      await loadLogs(date);
    }
  };

  const deleteLog = async (id: string) => {
    if (!confirm("この記録を削除しますか?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("workout_logs").delete().eq("id", id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      await loadLogs(date);
    }
  };

  const applyRoutine = async () => {
    const routine = routines.find((r) => r.id === routineId);
    if (!routine || routine.routine_items.length === 0) return;
    setApplying(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const rows = [...routine.routine_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        user_id: user.id,
        workout_date: date,
        exercise_id: item.exercise_id,
        weight_kg: item.default_weight_kg ?? 0,
        reps: item.default_reps,
        sets: item.default_sets,
      }));
    const { error } = await supabase.from("workout_logs").insert(rows);
    if (error) {
      setError(`ルーティンの展開に失敗しました: ${error.message}`);
    } else {
      setRoutineId("");
      await loadLogs(date);
    }
    setApplying(false);
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
  };

  return (
    <main className="p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">💪 ワークアウト記録</h1>
        <button
          onClick={signOut}
          className="rounded-lg px-2 py-1 text-xs text-gray-500 active:bg-gray-200"
        >
          ログアウト
        </button>
      </header>

      {/* 日付選択 */}
      <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          日付
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-gray-500">{formatDateLabel(date)}</p>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* ルーティン展開 */}
      {routines.length > 0 && (
        <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">
          <label className="mb-1 block text-xs font-semibold text-gray-500">
            ルーティンから一括追加
          </label>
          <div className="flex gap-2">
            <select
              value={routineId}
              onChange={(e) => setRoutineId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">選択してください</option>
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}({r.routine_items.length}種目)
                </option>
              ))}
            </select>
            <button
              onClick={applyRoutine}
              disabled={!routineId || applying}
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              展開
            </button>
          </div>
        </div>
      )}

      {/* 記録一覧 */}
      <section className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          この日の記録({logs.length}件)
        </h2>
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-400 shadow-sm">
            まだ記録がありません
          </p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="rounded-xl bg-white p-3 shadow-sm">
                {edit?.id === log.id ? (
                  <div>
                    <p className="mb-2 font-semibold">
                      {log.exercises?.name ?? "(削除された種目)"}
                    </p>
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      <label className="text-xs text-gray-500">
                        重量(kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          value={edit.weight_kg}
                          onChange={(e) =>
                            setEdit({ ...edit, weight_kg: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                      <label className="text-xs text-gray-500">
                        回数
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={edit.reps}
                          onChange={(e) =>
                            setEdit({ ...edit, reps: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                      <label className="text-xs text-gray-500">
                        セット
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={edit.sets}
                          onChange={(e) =>
                            setEdit({ ...edit, sets: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEdit(null)}
                        className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {log.exercises?.name ?? "(削除された種目)"}
                      </p>
                      <p className="text-sm text-gray-600">
                        {log.weight_kg}kg × {log.reps}回 × {log.sets}セット
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() =>
                          setEdit({
                            id: log.id,
                            weight_kg: String(log.weight_kg),
                            reps: String(log.reps),
                            sets: String(log.sets),
                          })
                        }
                        className="rounded-lg bg-gray-100 px-3 py-2 text-sm active:bg-gray-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteLog(log.id)}
                        className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 active:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 追加フォーム */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">記録を追加</h2>
        {exercises.length === 0 && !loading ? (
          <p className="text-sm text-gray-500">
            種目が登録されていません。「種目」タブから登録してください。
          </p>
        ) : (
          <form onSubmit={addLog}>
            <select
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
              required
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">種目を選択</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.muscle_group ? `[${ex.muscle_group}] ` : ""}
                  {ex.name}
                </option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <label className="text-xs text-gray-500">
                重量(kg)
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="60"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-500">
                回数
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-500">
                セット
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={sets}
                  onChange={(e) => setSets(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving || !exerciseId}
              className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              追加する
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RecordPage />
    </Suspense>
  );
}
