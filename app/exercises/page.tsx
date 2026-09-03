"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import HelpButton from "@/components/HelpButton";
import { Dumbbell } from "lucide-react";
import { DEFAULT_EXERCISES } from "@/lib/defaultExercises";
import {
  MUSCLE_GROUPS,
  groupByMuscleGroup,
  normalizeMuscleGroup,
} from "@/lib/muscleGroups";
import type { Exercise } from "@/lib/types";

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [muscleGroup, setMuscleGroup] = useState<string>(MUSCLE_GROUPS[0]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    muscle_group: string;
  } | null>(null);

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
    // セッションが切れている場合(AppShell が /login に飛ばす)。
    // ボタンが押せないまま固まらないよう保存中フラグは戻しておく。
    if (!user) {
      setSaving(false);
      return;
    }
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
    // セッションが切れている場合(AppShell が /login に飛ばす)。
    // ボタンが押せないまま固まらないよう保存中フラグは戻しておく。
    if (!user) {
      setSaving(false);
      return;
    }
    const rows = DEFAULT_EXERCISES.map((ex) => ({ ...ex, user_id: user.id }));
    const { error } = await supabase.from("exercises").insert(rows);
    if (error) {
      setError(`初期種目の登録に失敗しました: ${error.message}`);
    } else {
      await load();
    }
    setSaving(false);
  };

  const saveExercise = async () => {
    if (!editing || !editing.name.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("exercises")
      .update({
        name: editing.name.trim(),
        muscle_group: editing.muscle_group,
      })
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

  // 部位ごとにグループ化(表示順は 胸 → 背中 → 肩 → 腕 → 脚 → 体幹 → 有酸素 → その他)
  const grouped = groupByMuscleGroup(exercises, (ex) =>
    normalizeMuscleGroup(ex.muscle_group, ex.name)
  );

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Dumbbell aria-hidden size={20} strokeWidth={2} />
          種目マスタ
        </h1>
        <HelpButton tour="exercises" />
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 追加フォーム */}
      <form
        onSubmit={addExercise}
        data-tour="exercises-add"
        className="mb-4 rounded-xl bg-white p-3 shadow-sm"
      >
        <h2 className="mb-2 text-sm font-semibold text-gray-600">種目を追加</h2>
        <div className="flex gap-2">
          <select
            value={muscleGroup}
            data-tour="exercises-muscle"
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
            data-tour="exercises-seed"
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            代表的な種目をまとめて登録
          </button>
        </div>
      ) : (
        grouped.map(({ group, items }) => (
          <section key={group} data-tour="exercises-list" className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              {group}
              <span className="ml-1 font-normal text-gray-400">
                ({items.length}種目)
              </span>
            </h2>
            <ul className="space-y-2">
              {items.map((ex) => (
                <li
                  key={ex.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm"
                >
                  {editing?.id === ex.id ? (
                    <div className="w-full">
                      <div className="mb-2 flex gap-2">
                        <label
                          htmlFor={`muscle-${ex.id}`}
                          className="sr-only"
                        >
                          部位
                        </label>
                        <select
                          id={`muscle-${ex.id}`}
                          value={editing.muscle_group}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              muscle_group: e.target.value,
                            })
                          }
                          className="w-24 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5"
                        >
                          {MUSCLE_GROUPS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={editing.name}
                          onChange={(e) =>
                            setEditing({ ...editing, name: e.target.value })
                          }
                          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={saveExercise}
                          className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white active:opacity-80"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="flex-1 rounded-lg bg-gray-200 px-3 py-1.5 text-sm active:opacity-80"
                        >
                          戻る
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="truncate font-medium">{ex.name}</span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() =>
                            setEditing({
                              id: ex.id,
                              name: ex.name,
                              muscle_group: normalizeMuscleGroup(
                                ex.muscle_group,
                                ex.name
                              ),
                            })
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
