import type { WorkoutLogWithExercise, WorkoutSet } from "@/lib/types";

/**
 * ワークアウト記録の集計と「前回との比較」の判定。
 * 表示側と切り離しておきたいので、副作用のない純粋関数だけを置く。
 */

export type SetLike = { weight_kg: number | string; reps: number | string };

/** セット配列を set_number 昇順にそろえる */
export function sortSets<T extends { set_number: number }>(sets: T[]): T[] {
  return [...sets].sort((a, b) => a.set_number - b.set_number);
}

/** その種目の最大重量(kg) */
export function maxWeight(sets: SetLike[]): number {
  return sets.reduce((max, s) => Math.max(max, Number(s.weight_kg) || 0), 0);
}

/** 総ボリューム(重量 × 回数 の合計) */
export function totalVolume(sets: SetLike[]): number {
  return sets.reduce(
    (sum, s) => sum + (Number(s.weight_kg) || 0) * (Number(s.reps) || 0),
    0
  );
}

/** 総レップ数 */
export function totalReps(sets: SetLike[]): number {
  return sets.reduce((sum, s) => sum + (Number(s.reps) || 0), 0);
}

export type WorkoutSummary = {
  setCount: number;
  maxWeight: number;
  totalVolume: number;
  totalReps: number;
};

export function summarize(sets: SetLike[]): WorkoutSummary {
  return {
    setCount: sets.length,
    maxWeight: maxWeight(sets),
    totalVolume: totalVolume(sets),
    totalReps: totalReps(sets),
  };
}

/** 1 セットでも重量が入っているか(自重種目・重量未入力の判定に使う) */
export function hasWeight(sets: SetLike[]): boolean {
  return sets.some((s) => (Number(s.weight_kg) || 0) > 0);
}

/**
 * 記録 1 件を要約した 1 行(「3セット · 最大80kg · 総ボリューム1,920kg」)。
 *
 * 数値が何を指すのか分かるようにラベルを必ず付ける。
 * 重量が 1 セットも入っていない記録(自重種目 / ルーティンを展開しただけで
 * 重量を入れていない記録)で「最大 0kg · 0kg」と出すと誤解を招くので、
 * その場合は重量ではなく回数で要約する。
 */
export function summaryLine(sets: SetLike[]): string {
  if (sets.length === 0) return "セット未入力";
  const setText = `${sets.length}セット`;
  if (!hasWeight(sets)) {
    return `${setText} · 重量なし · 計${formatNumber(totalReps(sets))}回`;
  }
  return `${setText} · 最大${formatWeight(maxWeight(sets))}kg · 総ボリューム${formatNumber(
    totalVolume(sets)
  )}kg`;
}

/** 前回比の向き。前回記録が無い / 同値のときは色を付けない */
export type TrendDirection = "up" | "down" | "same";

export type MetricComparison = {
  direction: TrendDirection;
  current: number;
  previous: number;
  /** current - previous */
  delta: number;
};

/**
 * 前回比の判定。
 * 浮動小数の誤差で「同じなのに増減あり」と出ないよう、わずかな差は同値扱いにする。
 */
export function compareMetric(
  current: number,
  previous: number,
  epsilon = 0.001
): MetricComparison {
  const delta = current - previous;
  const direction: TrendDirection =
    Math.abs(delta) <= epsilon ? "same" : delta > 0 ? "up" : "down";
  return { direction, current, previous, delta };
}

export type PreviousRecord = {
  date: string;
  sets: SetLike[];
};

export type WorkoutComparison = {
  previousDate: string;
  maxWeight: MetricComparison;
  totalVolume: MetricComparison;
};

/**
 * 同じ種目の前回記録と比べる。
 * 判定は「最大重量」と「総ボリューム(重量 × 回数の合計)」の両方を見る。
 * 前回記録が無ければ null(= 色を付けない)。
 */
export function compareWithPrevious(
  currentSets: SetLike[],
  previous: PreviousRecord | null
): WorkoutComparison | null {
  if (!previous) return null;
  return {
    previousDate: previous.date,
    maxWeight: compareMetric(maxWeight(currentSets), maxWeight(previous.sets)),
    totalVolume: compareMetric(
      totalVolume(currentSets),
      totalVolume(previous.sets)
    ),
  };
}

/**
 * 「種目 ID → その種目の直近の記録(この日より前)」を作る。
 * 日付降順で渡された記録から、種目ごとに最初に出てきたものを採用する。
 */
export function buildPreviousRecordMap(
  logsDesc: {
    exercise_id: string;
    workout_date: string;
    workout_sets: WorkoutSet[] | null;
  }[]
): Map<string, PreviousRecord> {
  const map = new Map<string, PreviousRecord>();
  for (const log of logsDesc) {
    if (map.has(log.exercise_id)) continue;
    const sets = log.workout_sets ?? [];
    // セットが 1 つも無い記録は比較対象にしない
    if (sets.length === 0) continue;
    map.set(log.exercise_id, { date: log.workout_date, sets });
  }
  return map;
}

/** 直近の同じ種目のメモ(記録するときの参考に出す) */
export type PreviousMemo = {
  date: string;
  memo: string;
};

/** メモの表示用テキスト。空白だけのメモは「無い」ものとして扱う */
export function memoText(memo: string | null | undefined): string {
  return (memo ?? "").trim();
}

/** メモが入っているか */
export function hasMemo(memo: string | null | undefined): boolean {
  return memoText(memo).length > 0;
}

/**
 * 「種目 ID → その種目の直近のメモ(この日より前)」を作る。
 * 日付降順で渡された記録から、種目ごとに最初に見つかった空でないメモを採用する。
 *
 * セットの比較(buildPreviousRecordMap)と違って、
 * セットが 1 つも無い日の記録でもメモだけは拾う。
 */
export function buildPreviousMemoMap(
  logsDesc: {
    exercise_id: string;
    workout_date: string;
    memo: string | null;
  }[]
): Map<string, PreviousMemo> {
  const map = new Map<string, PreviousMemo>();
  for (const log of logsDesc) {
    if (map.has(log.exercise_id)) continue;
    const memo = memoText(log.memo);
    if (!memo) continue;
    map.set(log.exercise_id, { date: log.workout_date, memo });
  }
  return map;
}

/**
 * 記録 1 件を「80kg×10回 / 80kg×8回 / 70kg×8回」のような文字列にする。
 * 重量がまったく入っていない記録は「0kg×10回」だと誤解を招くので回数だけを出す。
 */
export function formatSets(sets: SetLike[]): string {
  if (sets.length === 0) return "セット未入力";
  if (!hasWeight(sets)) {
    return `${sets.map((s) => `${Number(s.reps)}回`).join(" / ")}(重量なし)`;
  }
  return sets
    .map((s) => `${formatWeight(Number(s.weight_kg))}kg×${Number(s.reps)}回`)
    .join(" / ");
}

/** 記録一覧を sort_order 昇順にそろえる(同値なら作成順) */
export function sortLogs(
  logs: WorkoutLogWithExercise[]
): WorkoutLogWithExercise[] {
  return [...logs].sort(
    (a, b) =>
      a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  );
}

/** 数値を「1,234」形式にする(桁が多いボリューム表示用) */
export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 重量表示。80 は「80」、82.5 は「82.5」のように余計な小数を出さない */
export function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : String(Math.round(kg * 100) / 100);
}
