"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Exercise, RoutineWithItems } from "@/lib/types";

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<RoutineWithItems[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  // 展開中のルーティン(種目追加フォームを表示)
  const [openId, setOpenId] = useState<string | null>(null);
  const [itemExerciseId, setItemExerciseId] = useState("");
  const [itemWeight, setItemWeight] = useState("");
  const [itemReps, setItemReps] = useState("10");
  const [itemSets, setItemSets] = useState("3");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [rtRes, exRes] = await Promise.all([
      supabase
        .from("routines")
        .select("*, routine_items(*, exercises(id, name, muscle_group))")
        .order("name"),
      supabase.from("exercises").select("*").order("muscle_group").order("name"),
    ]);
    if (rtRes.error) {
      setError(`ルーティンの取得に失敗しました: ${rtRes.error.message}`);
    } else {
      setRoutines((rtRes.data as RoutineWithItems[]) ?? []);
    }
    if (!exRes.error) setExercises(exRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const addRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("routines")
      .insert({ user_id: user.id, name: newName.trim() });
    if (error) {
      setError(`作成に失敗しました: ${error.message}`);
    } else {
      setNewName("");
      await load();
    }
    setSaving(false);
  };

  const deleteRoutine = async (routine: RoutineWithItems) => {
    if (!confirm(`「${routine.name}」を削除しますか?`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("routines")
      .delete()
      .eq("id", routine.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      await load();
    }
  };

  const addItem = async (routine: RoutineWithItems) => {
    if (!itemExerciseId) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const maxOrder = Math.max(
      0,
      ...routine.routine_items.map((i) => i.sort_order)
    );
    const { error } = await supabase.from("routine_items").insert({
      routine_id: routine.id,
      exercise_id: itemExerciseId,
      default_weight_kg: itemWeight === "" ? null : Number(itemWeight),
      default_reps: Number(itemReps) || 0,
      default_sets: Number(itemSets) || 0,
      sort_order: maxOrder + 1,
    });
    if (error) {
      setError(`種目の追加に失敗しました: ${error.message}`);
    } else {
      setItemExerciseId("");
      setItemWeight("");
      await load();
    }
    setSaving(false);
  };

  const deleteItem = async (itemId: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("routine_items")
      .delete()
      .eq("id", itemId);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      await load();
    }
  };

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">📋 ルーティン</h1>
      <p className="mb-4 text-xs text-gray-500">
        「胸の日」「脚の日」のような種目の組み合わせを保存しておくと、記録ページからワンタップでその日の記録に展開できます。
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 作成フォーム */}
      <form
        onSubmit={addRoutine}
        className="mb-4 rounded-xl bg-white p-3 shadow-sm"
      >
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          ルーティンを作成
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: 胸の日"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            作成
          </button>
        </div>
      </form>

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
      ) : routines.length === 0 ? (
        <p className="rounded-xl bg-white py-8 text-center text-sm text-gray-400 shadow-sm">
          まだルーティンがありません
        </p>
      ) : (
        <ul className="space-y-3">
          {routines.map((routine) => {
            const items = [...routine.routine_items].sort(
              (a, b) => a.sort_order - b.sort_order
            );
            const isOpen = openId === routine.id;
            return (
              <li key={routine.id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate font-bold">{routine.name}</p>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => {
                        setOpenId(isOpen ? null : routine.id);
                        setItemExerciseId("");
                      }}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm active:bg-gray-200"
                    >
                      {isOpen ? "閉じる" : "種目を追加"}
                    </button>
                    <button
                      onClick={() => deleteRoutine(routine)}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 active:bg-red-100"
                    >
                      削除
                    </button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="text-sm text-gray-400">種目がありません</p>
                ) : (
                  <ul className="space-y-1">
                    {items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate text-gray-700">
                          {item.exercises?.name ?? "(削除された種目)"}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 pl-2">
                          <span className="text-gray-500">
                            {item.default_weight_kg != null
                              ? `${item.default_weight_kg}kg × `
                              : ""}
                            {item.default_reps}回 × {item.default_sets}set
                          </span>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-red-500 active:opacity-70"
                            aria-label="種目を外す"
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {isOpen && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <select
                      value={itemExerciseId}
                      onChange={(e) => setItemExerciseId(e.target.value)}
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
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      <label className="text-xs text-gray-500">
                        重量(kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          value={itemWeight}
                          onChange={(e) => setItemWeight(e.target.value)}
                          placeholder="任意"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                      <label className="text-xs text-gray-500">
                        回数
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={itemReps}
                          onChange={(e) => setItemReps(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                      <label className="text-xs text-gray-500">
                        セット
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={itemSets}
                          onChange={(e) => setItemSets(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                    </div>
                    <button
                      onClick={() => addItem(routine)}
                      disabled={saving || !itemExerciseId}
                      className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
                    >
                      このルーティンに追加
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
