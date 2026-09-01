"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SortableList from "@/components/SortableList";
import SetInputList, { nextSet } from "@/components/SetInputList";
import TrendBadges from "@/components/TrendBadges";
import { formatDateLabel, todayString } from "@/lib/date";
import { VIZ } from "@/lib/viz";
import {
  buildPreviousRecordMap,
  compareWithPrevious,
  formatWeight,
  maxWeight,
  sortLogs,
  sortSets,
  totalVolume,
  type PreviousRecord,
} from "@/lib/workoutStats";
import type {
  Exercise,
  RoutineWithItems,
  SetInput,
  WorkoutLogWithExercise,
  WorkoutSet,
} from "@/lib/types";

const PHASE4_SETUP_HINT = "(supabase/phase4.sql を実行済みか確認してください)";

/** DB のセットを入力フォーム用の文字列に変換する */
function toSetInputs(sets: WorkoutSet[]): SetInput[] {
  return sortSets(sets).map((s) => ({
    id: s.id,
    weight_kg: String(Number(s.weight_kg)),
    reps: String(Number(s.reps)),
  }));
}

/** 入力値を保存できる形(数値)に変換する。空欄は 0 扱い */
function toSetRows(sets: SetInput[]) {
  return sets.map((s, index) => ({
    set_number: index + 1,
    weight_kg: Number(s.weight_kg) || 0,
    reps: Number(s.reps) || 0,
  }));
}

function RecordPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(
    () => searchParams.get("date") ?? todayString()
  );
  const [logs, setLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [previous, setPrevious] = useState<Map<string, PreviousRecord>>(
    new Map()
  );
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<RoutineWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [exerciseId, setExerciseId] = useState("");
  const [newSets, setNewSets] = useState<SetInput[]>([
    { id: null, weight_kg: "", reps: "10" },
  ]);
  const [saving, setSaving] = useState(false);

  // 編集(記録 1 件分のセットをまとめて編集する)
  const [editId, setEditId] = useState<string | null>(null);
  const [editSets, setEditSets] = useState<SetInput[]>([]);

  // ルーティン展開
  const [routineId, setRoutineId] = useState("");
  const [applying, setApplying] = useState(false);

  /** その日の記録と、同じ種目の「前回の記録」をまとめて取得する */
  const loadLogs = useCallback(async (targetDate: string) => {
    const supabase = createClient();
    const { data, error: logError } = await supabase
      .from("workout_logs")
      .select("*, exercises(id, name, muscle_group), workout_sets(*)")
      .eq("workout_date", targetDate)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (logError) {
      setError(`記録の取得に失敗しました: ${logError.message}${PHASE4_SETUP_HINT}`);
      return;
    }
    const dayLogs = sortLogs((data as WorkoutLogWithExercise[]) ?? []);
    setLogs(dayLogs);
    setError(null);

    const exerciseIds = [...new Set(dayLogs.map((l) => l.exercise_id))];
    if (exerciseIds.length === 0) {
      setPrevious(new Map());
      return;
    }

    // その日より前の記録を新しい順に取り、種目ごとに最初の 1 件を「前回」とする
    const { data: prevData } = await supabase
      .from("workout_logs")
      .select("exercise_id, workout_date, workout_sets(weight_kg, reps, set_number)")
      .in("exercise_id", exerciseIds)
      .lt("workout_date", targetDate)
      .order("workout_date", { ascending: false })
      .limit(200);

    setPrevious(
      buildPreviousRecordMap(
        (prevData as
          | {
              exercise_id: string;
              workout_date: string;
              workout_sets: WorkoutSet[] | null;
            }[]
          | null) ?? []
      )
    );
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
      setEditId(null);
      await loadLogs(date);
    })();
  }, [date, loadLogs]);

  const addLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exerciseId) return;
    if (newSets.length === 0) {
      setError("セットを 1 つ以上追加してください。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const maxOrder = logs.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data: inserted, error: insertError } = await supabase
      .from("workout_logs")
      .insert({
        user_id: user.id,
        workout_date: date,
        exercise_id: exerciseId,
        sort_order: maxOrder + 1,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setError(
        `保存に失敗しました: ${insertError?.message ?? "不明なエラー"}${PHASE4_SETUP_HINT}`
      );
      setSaving(false);
      return;
    }

    const { error: setsError } = await supabase.from("workout_sets").insert(
      toSetRows(newSets).map((row) => ({
        workout_log_id: inserted.id as string,
        ...row,
      }))
    );
    if (setsError) {
      setError(`セットの保存に失敗しました: ${setsError.message}`);
    } else {
      // 次の種目もだいたい同じセット構成なので、直前の入力を残しておく
      setExerciseId("");
    }
    await loadLogs(date);
    setSaving(false);
  };

  const startEdit = (log: WorkoutLogWithExercise) => {
    setEditId(log.id);
    const inputs = toSetInputs(log.workout_sets ?? []);
    setEditSets(inputs.length > 0 ? inputs : [nextSet([])]);
  };

  const saveEdit = async () => {
    if (!editId) return;
    if (editSets.length === 0) {
      setError("セットを 1 つ以上残してください(記録ごと消す場合は削除ボタンから)。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    // set_number を振り直すので、いったん全部消してから入れ直す
    const { error: delError } = await supabase
      .from("workout_sets")
      .delete()
      .eq("workout_log_id", editId);
    if (delError) {
      setError(`更新に失敗しました: ${delError.message}`);
      setSaving(false);
      return;
    }
    const { error: insError } = await supabase.from("workout_sets").insert(
      toSetRows(editSets).map((row) => ({ workout_log_id: editId, ...row }))
    );
    if (insError) {
      setError(`更新に失敗しました: ${insError.message}`);
    } else {
      setEditId(null);
    }
    await loadLogs(date);
    setSaving(false);
  };

  const deleteLog = async (id: string) => {
    if (!confirm("この記録を削除しますか?")) return;
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("workout_logs")
      .delete()
      .eq("id", id);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      await loadLogs(date);
    }
  };

  /** ドラッグ&ドロップの結果を sort_order として保存する */
  const reorderLogs = async (next: WorkoutLogWithExercise[]) => {
    const renumbered = next.map((log, index) => ({
      ...log,
      sort_order: index + 1,
    }));
    setLogs(renumbered); // 先に画面を動かして、待たせない
    const supabase = createClient();
    const results = await Promise.all(
      renumbered.map((log) =>
        supabase
          .from("workout_logs")
          .update({ sort_order: log.sort_order })
          .eq("id", log.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(`並び順の保存に失敗しました: ${failed.error.message}`);
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
    if (!user) {
      setApplying(false);
      return;
    }

    const items = [...routine.routine_items].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const maxOrder = logs.reduce((m, l) => Math.max(m, l.sort_order), 0);

    const { data: inserted, error: insertError } = await supabase
      .from("workout_logs")
      .insert(
        items.map((item, index) => ({
          user_id: user.id,
          workout_date: date,
          exercise_id: item.exercise_id,
          sort_order: maxOrder + index + 1,
        }))
      )
      .select("id, exercise_id, sort_order");

    if (insertError || !inserted) {
      setError(
        `ルーティンの展開に失敗しました: ${insertError?.message ?? "不明なエラー"}${PHASE4_SETUP_HINT}`
      );
      setApplying(false);
      return;
    }

    // ルーティンの初期値(目標セット数・重量・回数)をセットに展開する
    const insertedRows = inserted as {
      id: string;
      exercise_id: string;
      sort_order: number;
    }[];
    const sorted = [...insertedRows].sort((a, b) => a.sort_order - b.sort_order);
    const setRows = sorted.flatMap((row, index) => {
      const item = items[index];
      const count = Math.max(item?.default_sets ?? 1, 1);
      return Array.from({ length: count }, (_, i) => ({
        workout_log_id: row.id,
        set_number: i + 1,
        weight_kg: Number(item?.default_weight_kg ?? 0) || 0,
        reps: item?.default_reps ?? 0,
      }));
    });

    const { error: setInsertError } = await supabase
      .from("workout_sets")
      .insert(setRows);
    if (setInsertError) {
      setError(`セットの展開に失敗しました: ${setInsertError.message}`);
    } else {
      setRoutineId("");
    }
    await loadLogs(date);
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
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-semibold text-gray-500">
            日付
          </label>
          <Link
            href={`/calendar?date=${date}`}
            className="text-xs font-semibold text-blue-600"
          >
            カレンダーで選ぶ ›
          </Link>
        </div>
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
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-600">
            この日の記録({logs.length}件)
          </h2>
          {logs.length > 1 && (
            <p className="text-xs text-gray-500">⠿ を長押しで並べ替え</p>
          )}
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-400 shadow-sm">
            まだ記録がありません
          </p>
        ) : (
          <SortableList
            items={logs}
            onReorder={reorderLogs}
            itemLabel="種目"
            className="space-y-2"
          >
            {(log, { dragHandle }) => {
              const sets = sortSets(log.workout_sets ?? []);
              const comparison = compareWithPrevious(
                sets,
                previous.get(log.exercise_id) ?? null
              );
              const isEditing = editId === log.id;

              return (
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  {isEditing ? (
                    <div>
                      <p className="mb-2 font-semibold">
                        {log.exercises?.name ?? "(削除された種目)"}
                      </p>
                      <SetInputList
                        sets={editSets}
                        onChange={setEditSets}
                        idPrefix={`edit-${log.id}`}
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          {dragHandle}
                          <p className="min-w-0 truncate font-semibold">
                            {log.exercises?.name ?? "(削除された種目)"}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => startEdit(log)}
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

                      {sets.length === 0 ? (
                        <p className="mt-1 pl-9 text-sm text-gray-400">
                          セットが未入力です
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 pl-9">
                          {sets.map((s, i) => (
                            <li
                              key={s.id}
                              className="flex items-baseline gap-2 text-sm"
                            >
                              <span
                                className="w-9 shrink-0 text-xs tabular-nums"
                                style={{ color: VIZ.muted }}
                              >
                                {i + 1}set
                              </span>
                              <span className="tabular-nums text-gray-700">
                                {formatWeight(Number(s.weight_kg))}kg ×{" "}
                                {Number(s.reps)}回
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="pl-9">
                        <TrendBadges
                          comparison={comparison}
                          maxWeight={maxWeight(sets)}
                          totalVolume={totalVolume(sets)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          </SortableList>
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
              className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">種目を選択</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.muscle_group ? `[${ex.muscle_group}] ` : ""}
                  {ex.name}
                </option>
              ))}
            </select>

            <SetInputList
              sets={newSets}
              onChange={setNewSets}
              idPrefix="new"
            />

            <button
              type="submit"
              disabled={saving || !exerciseId || newSets.length === 0}
              className="mt-3 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
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
