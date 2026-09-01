"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_EXERCISES, MUSCLE_GROUPS } from "@/lib/defaultExercises";
import type { Exercise } from "@/lib/types";

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [muscleGroup, setMuscleGroup] = useState(MUSCLE_GROUPS[0]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  );

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .order("muscle_group")
      .order("name");
    if (error) {
      setError(`種目の取得に失敗しました: ${error.message}`);
    } else {
      setExercises(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const addExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("exercises").insert({
      user_id: user.id,
      name: name.trim(),
      muscle_group: muscleGroup,
    });
    if (error) {
      setError(`登録に失敗しました: ${error.message}`);
    } else {
      setName("");
      await load();
    }
    setSaving(false);
  };

  const seedDefaults = async () => {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const rows = DEFAULT_EXERCISES.map((ex) => ({ ...ex, user_id: user.id }));
    const { error } = await supabase.from("exercises").insert(rows);
    if (error) {
      setError(`初期種目の登録に失敗しました: ${error.message}`);
    } else {
      await load();
    }
    setSaving(false);
  };

  const renameExercise = async () => {
    if (!editing || !editing.name.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("exercises")
      .update({ name: editing.name.trim() })
      .eq("id", editing.id);
    if (error) {
      setError(`更新に失敗しました: ${error.message}`);
    } else {
      setEditing(null);
      await load();
    }
  };

  const deleteExercise = async (ex: Exercise) => {
    if (
      !confirm(
        `「${ex.name}」を削除しますか?\nこの種目の過去の記録も削除されます。`
      )
    )
      return;
    const supabase = createClient();
    const { error } = await supabase.from("exercises").delete().eq("id", ex.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      await load();
    }
  };

  // 部位ごとにグループ化
  const grouped = exercises.reduce<Map<string, Exercise[]>>((map, ex) => {
    const key = ex.muscle_group ?? "その他";
    const list = map.get(key) ?? [];
    list.push(ex);
    map.set(key, list);
    return map;
  }, new Map());

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">🏋️ 種目マスタ</h1>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 追加フォーム */}
      <form
        onSubmit={addExercise}
        className="mb-4 rounded-xl bg-white p-3 shadow-sm"
      >
        <h2 className="mb-2 text-sm font-semibold text-gray-600">種目を追加</h2>
        <div className="flex gap-2">
          <select
            value={muscleGroup}
            onChange={(e) => setMuscleGroup(e.target.value)}
            className="w-24 shrink-0 rounded-lg border border-gray-300 px-2 py-2"
          >
            {MUSCLE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: ベンチプレス"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            追加
          </button>
        </div>
      </form>

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
      ) : exercises.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center shadow-sm">
          <p className="mb-3 text-sm text-gray-500">
            種目がまだ登録されていません。
          </p>
          <button
            onClick={seedDefaults}
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            代表的な種目をまとめて登録
          </button>
        </div>
      ) : (
        [...grouped.entries()].map(([group, list]) => (
          <section key={group} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              {group}
            </h2>
            <ul className="space-y-2">
              {list.map((ex) => (
                <li
                  key={ex.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm"
                >
                  {editing?.id === ex.id ? (
                    <>
                      <input
                        type="text"
                        value={editing.name}
                        onChange={(e) =>
                          setEditing({ ...editing, name: e.target.value })
                        }
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5"
                      />
                      <button
                        onClick={renameExercise}
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white active:opacity-80"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="shrink-0 rounded-lg bg-gray-200 px-3 py-1.5 text-sm active:opacity-80"
                      >
                        戻る
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="truncate font-medium">{ex.name}</span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() =>
                            setEditing({ id: ex.id, name: ex.name })
                          }
                          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm active:bg-gray-200"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => deleteExercise(ex)}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 active:bg-red-100"
                        >
                          削除
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
