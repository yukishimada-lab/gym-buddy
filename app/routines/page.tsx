"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SortableList from "@/components/SortableList";
import type {
  Exercise,
  RoutineItemWithExercise,
  RoutineWithItems,
} from "@/lib/types";
import { formatWeight } from "@/lib/workoutStats";

/** ルーティン内の種目を sort_order 昇順にそろえる */
function sortItems(items: RoutineItemWithExercise[]) {
  return [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)
  );
}

type ItemForm = {
  default_weight_kg: string;
  default_reps: string;
  default_sets: string;
};

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

  // 登録済みの種目の数値を後から編集する
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ItemForm>({
    default_weight_kg: "",
    default_reps: "",
    default_sets: "",
  });

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
      setRoutines(
        ((rtRes.data as RoutineWithItems[]) ?? []).map((r) => ({
          ...r,
          routine_items: sortItems(r.routine_items ?? []),
        }))
      );
      setError(null);
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
    if (!user) {
      setSaving(false);
      return;
    }
    const { error: insError } = await supabase
      .from("routines")
      .insert({ user_id: user.id, name: newName.trim() });
    if (insError) {
      setError(`作成に失敗しました: ${insError.message}`);
    } else {
      setNewName("");
      await load();
    }
    setSaving(false);
  };

  const deleteRoutine = async (routine: RoutineWithItems) => {
    if (!confirm(`「${routine.name}」を削除しますか?`)) return;
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("routines")
      .delete()
      .eq("id", routine.id);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      await load();
    }
  };

  const addItem = async (routine: RoutineWithItems) => {
    if (!itemExerciseId) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const maxOrder = routine.routine_items.reduce(
      (m, i) => Math.max(m, i.sort_order),
      0
    );
    const { error: insError } = await supabase.from("routine_items").insert({
      routine_id: routine.id,
      exercise_id: itemExerciseId,
      default_weight_kg: itemWeight === "" ? null : Number(itemWeight),
      default_reps: Number(itemReps) || 0,
      default_sets: Number(itemSets) || 0,
      sort_order: maxOrder + 1,
    });
    if (insError) {
      setError(`種目の追加に失敗しました: ${insError.message}`);
    } else {
      setItemExerciseId("");
      setItemWeight("");
      await load();
    }
    setSaving(false);
  };

  const deleteItem = async (itemId: string) => {
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("routine_items")
      .delete()
      .eq("id", itemId);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      await load();
    }
  };

  const startEditItem = (item: RoutineItemWithExercise) => {
    setEditItemId(item.id);
    setEditForm({
      default_weight_kg:
        item.default_weight_kg != null
          ? String(Number(item.default_weight_kg))
          : "",
      default_reps: String(item.default_reps),
      default_sets: String(item.default_sets),
    });
  };

  const saveEditItem = async () => {
    if (!editItemId) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updError } = await supabase
      .from("routine_items")
      .update({
        default_weight_kg:
          editForm.default_weight_kg.trim() === ""
            ? null
            : Number(editForm.default_weight_kg),
        default_reps: Number(editForm.default_reps) || 0,
        default_sets: Number(editForm.default_sets) || 0,
      })
      .eq("id", editItemId);
    if (updError) {
      setError(`更新に失敗しました: ${updError.message}`);
    } else {
      setEditItemId(null);
      await load();
    }
    setSaving(false);
  };

  /** ドラッグ&ドロップの結果を sort_order として保存する */
  const reorderItems = async (
    routine: RoutineWithItems,
    next: RoutineItemWithExercise[]
  ) => {
    const renumbered = next.map((item, index) => ({
      ...item,
      sort_order: index + 1,
    }));
    // 先に画面を動かして、保存待ちで固まらないようにする
    setRoutines((prev) =>
      prev.map((r) =>
        r.id === routine.id ? { ...r, routine_items: renumbered } : r
      )
    );
    const supabase = createClient();
    const results = await Promise.all(
      renumbered.map((item) =>
        supabase
          .from("routine_items")
          .update({ sort_order: item.sort_order })
          .eq("id", item.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(`並び順の保存に失敗しました: ${failed.error.message}`);
      await load();
    }
  };

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">📋 ルーティン</h1>
      <p className="mb-4 text-xs text-gray-500">
        「胸の日」「脚の日」のような種目の組み合わせを保存しておくと、記録ページからワンタップでその日の記録に展開できます。
        種目の順番は ⠿ を長押ししてドラッグすると並べ替えられます。
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
            const items = routine.routine_items;
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
                  <SortableList
                    items={items}
                    onReorder={(next) => reorderItems(routine, next)}
                    itemLabel="種目"
                    className="space-y-1"
                  >
                    {(item, { dragHandle }) =>
                      editItemId === item.id ? (
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="mb-2 truncate text-sm font-semibold">
                            {item.exercises?.name ?? "(削除された種目)"}
                          </p>
                          <div className="mb-2 grid grid-cols-3 gap-2">
                            <label className="text-xs text-gray-500">
                              重量(kg)
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.5"
                                min="0"
                                placeholder="任意"
                                value={editForm.default_weight_kg}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    default_weight_kg: e.target.value,
                                  })
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
                                value={editForm.default_reps}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    default_reps: e.target.value,
                                  })
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
                                value={editForm.default_sets}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    default_sets: e.target.value,
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                              />
                            </label>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={saveEditItem}
                              disabled={saving}
                              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditItemId(null)}
                              className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          {dragHandle}
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                            {item.exercises?.name ?? "(削除された種目)"}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-gray-500">
                            {item.default_weight_kg != null
                              ? `${formatWeight(Number(item.default_weight_kg))}kg × `
                              : ""}
                            {item.default_reps}回 × {item.default_sets}set
                          </span>
                          <button
                            onClick={() => startEditItem(item)}
                            className="shrink-0 rounded-lg bg-gray-100 px-2 py-1.5 text-xs active:bg-gray-200"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="shrink-0 rounded-lg px-1.5 py-1.5 text-sm text-red-500 active:bg-red-50"
                            aria-label={`${item.exercises?.name ?? "この種目"}をルーティンから外す`}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    }
                  </SortableList>
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
