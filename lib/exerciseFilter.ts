import { muscleGroupOrder, normalizeMuscleGroup, type MuscleGroup } from "./muscleGroups";
import type { Exercise } from "./types";

/**
 * 種目の絞り込み(部位フィルタ + 名前検索)。
 *
 * 種目が増えると 1 つのプルダウンに全部並んで選べなくなるため、
 * 「部位で絞る」「名前で探す」の 2 つで候補を減らす。
 * 画面から切り離してテストできるよう、判定はここに置く。
 */

/** 絞り込みに使う最低限の種目情報(Exercise でも表示用の型でも渡せるように) */
export type FilterableExercise = Pick<Exercise, "id" | "name" | "muscle_group">;

/** 部位フィルタの「すべて」を表す値 */
export const ALL_GROUPS = "" as const;

/** その種目の部位(未設定なら種目名から推定する) */
export function exerciseGroup(exercise: FilterableExercise): MuscleGroup {
  return normalizeMuscleGroup(exercise.muscle_group, exercise.name);
}

/**
 * 検索文字列をそろえる。
 * 大文字小文字と全角スペースの違いで「見つからない」と言われないようにする。
 */
function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/　/g, " ");
}

/**
 * 種目を「部位 → 名前」の順に並べる。
 * 部位の順番は MUSCLE_GROUPS 固定(胸 → 背中 → 肩 → 腕 → 脚 → 体幹 → 有酸素 → その他)。
 */
export function sortExercises<T extends FilterableExercise>(exercises: T[]): T[] {
  return [...exercises].sort((a, b) => {
    const diff = muscleGroupOrder(exerciseGroup(a)) - muscleGroupOrder(exerciseGroup(b));
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, "ja");
  });
}

/**
 * 部位と検索語で絞り込む。
 *
 * 検索語はスペース区切りの AND 条件で、種目名だけでなく部位名にも当てる
 * (「胸 プレス」で胸のプレス系だけを出せる)。
 */
export function filterExercises<T extends FilterableExercise>(
  exercises: T[],
  options: { group?: string; query?: string } = {}
): T[] {
  const group = options.group ?? ALL_GROUPS;
  const words = normalizeQuery(options.query ?? "").split(/\s+/).filter(Boolean);

  const matched = exercises.filter((exercise) => {
    if (group !== ALL_GROUPS && exerciseGroup(exercise) !== group) return false;
    if (words.length === 0) return true;
    const haystack = `${exercise.name} ${exerciseGroup(exercise)}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });

  return sortExercises(matched);
}

/**
 * 部位フィルタのボタンに出す「部位と件数」。
 * 1 件も種目が無い部位はボタンを出さない(押しても空になるだけなので)。
 */
export function groupCounts(exercises: FilterableExercise[]): {
  group: MuscleGroup;
  count: number;
}[] {
  const counts = new Map<MuscleGroup, number>();
  for (const exercise of exercises) {
    const group = exerciseGroup(exercise);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => muscleGroupOrder(a) - muscleGroupOrder(b))
    .map(([group, count]) => ({ group, count }));
}
