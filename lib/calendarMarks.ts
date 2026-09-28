import { mainMuscleGroup } from "./muscleGroups";

/**
 * カレンダーのマス目に出す印を組み立てる。
 *
 * 取得した月ぶんの記録をそのまま持っておき、ここで印に変換する。
 * ルーティンでの絞り込みを切り替えるたびに取り直さずに済むよう、
 * 通信と組み立てを分けている(純粋な関数なのでテストもできる)。
 */

/** 月ぶんのトレーニング記録(1 種目 = 1 行) */
export type MonthWorkoutRow = {
  date: string;
  /** 正規化済みの部位 */
  group: string;
  /** どのルーティンを展開して作られたか。手で足した記録は null */
  routineId: string | null;
};

/** カレンダーのマス目に出すマーク */
export type DayMarks = {
  workout: boolean;
  meal: boolean;
  /** その日の主な部位(マスに出すラベル)。トレーニングが無い日は未設定 */
  group?: string;
  /** 主な部位のほかにもやった部位があるか(「+」を付けるかの判定) */
  hasOtherGroups?: boolean;
};

/**
 * @param workouts 月ぶんのトレーニング記録
 * @param mealDates 食事の記録がある日
 * @param routineId 絞り込むルーティン。null なら絞り込まない
 *
 * ルーティンで絞り込んでいるあいだは、食事の印も出さない。
 * 「このルーティンをやった日」を探しているときに、
 * 関係のない日にも印が付いていると数えられなくなるため。
 */
export function buildDayMarks(
  workouts: MonthWorkoutRow[],
  mealDates: string[],
  routineId: string | null,
): Map<string, DayMarks> {
  const filtering = routineId != null && routineId !== "";
  const rows = filtering
    ? workouts.filter((row) => row.routineId === routineId)
    : workouts;

  const map = new Map<string, DayMarks>();
  const ensure = (date: string): DayMarks => {
    const current = map.get(date) ?? { workout: false, meal: false };
    map.set(date, current);
    return current;
  };

  // 日付ごとに、その日やった種目の部位を集める
  const groupsByDate = new Map<string, string[]>();
  for (const row of rows) {
    ensure(row.date).workout = true;
    const list = groupsByDate.get(row.date) ?? [];
    list.push(row.group);
    groupsByDate.set(row.date, list);
  }

  // その日の主な部位を決める(同数なら表示順で先のもの)
  for (const [date, groups] of groupsByDate) {
    const main = mainMuscleGroup(groups);
    const current = map.get(date);
    if (main && current) {
      current.group = main.group;
      current.hasOtherGroups = main.hasOthers;
    }
  }

  if (!filtering) {
    for (const date of mealDates) ensure(date).meal = true;
  }

  return map;
}

/**
 * 絞り込んだルーティンを、その月に何回やったかを数える。
 * カレンダーは前後の月の日もマス目に出すので、その月の日だけを数える。
 */
export function countRoutineDaysInMonth(
  workouts: MonthWorkoutRow[],
  routineId: string,
  year: number,
  month: number,
): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const dates = new Set(
    workouts
      .filter(
        (row) => row.routineId === routineId && row.date.startsWith(prefix),
      )
      .map((row) => row.date),
  );
  return dates.size;
}
