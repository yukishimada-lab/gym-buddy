import type { GoalAnalysisInput, GoalMode } from "@/lib/types";

/**
 * 目標サポート分析の計算ロジック。
 * クライアント(表示)とサーバー(Gemini へのプロンプト生成)の
 * 両方から同じ数値を使えるように、副作用のない純粋関数だけを置く。
 */

/** 体脂肪 1kg の増減に必要なカロリー(一般的な目安値) */
export const KCAL_PER_KG = 7200;

/** 体重あたりの推奨タンパク質量(筋トレをしている人の一般的な目安 g/kg) */
export const PROTEIN_G_PER_KG = 2.0;

/** 直近トレンド・平均の集計に使う日数 */
export const TREND_WINDOW_DAYS = 28;
export const NUTRITION_WINDOW_DAYS = 14;

export const GOAL_MODE_LABEL: Record<GoalMode, string> = {
  bulk: "増量",
  cut: "減量",
  maintain: "維持",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** YYYY-MM-DD をローカル日付として Date にする(タイムゾーンずれ防止) */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date を YYYY-MM-DD にする */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 2 つの YYYY-MM-DD の日数差(to - from) */
export function diffDays(from: string, to: string): number {
  const ms = parseDate(to).getTime() - parseDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** n 日後の YYYY-MM-DD */
export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/**
 * 日付付きの数値列に最小二乗法をあてはめて「1 日あたりの変化量」を返す。
 * 2 点未満、または全点が同日の場合は null。
 */
export function slopePerDay(
  points: { date: string; value: number }[]
): number | null {
  if (points.length < 2) return null;
  const base = points[0].date;
  const xs = points.map((p) => diffDays(base, p.date));
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/** 平均(空配列なら null) */
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type GoalAnalysis = {
  /** 分析の基準日(通常は今日) */
  today: string;
  /** 目標のモード */
  mode: GoalMode;

  // ---- 現在地 ----
  currentWeight: number | null;
  currentWeightDate: string | null;
  currentBodyFat: number | null;
  currentBodyFatDate: string | null;

  // ---- 目標との差分 ----
  targetWeight: number | null;
  /** 目標体重 - 現在体重(プラス = 増やす必要あり) */
  weightDiff: number | null;
  targetBodyFat: number | null;
  /** 目標体脂肪率 - 現在体脂肪率 */
  bodyFatDiff: number | null;
  targetDate: string | null;
  /** 目標達成希望日までの残り日数(過ぎていればマイナス) */
  daysLeft: number | null;

  // ---- 必要なカロリー収支 ----
  /** 目標達成に必要な 1 日あたりのカロリー収支(プラス = 余剰が必要) */
  requiredDailyBalance: number | null;
  /** 推定メンテナンスカロリー(kcal/日) */
  estimatedMaintenance: number | null;
  /** メンテナンスの推定根拠 */
  maintenanceBasis: "inbody_bmr" | "weight_estimate" | null;
  /** 目標達成のための 1 日あたり摂取カロリーの目安 */
  targetDailyCalories: number | null;
  /** 1 日あたりの推奨タンパク質量(g) */
  targetDailyProtein: number | null;

  // ---- 直近の食事傾向 ----
  /** 平均を取った対象日数(食事記録がある日のみ) */
  nutritionDays: number;
  avgCalories: number | null;
  avgProtein: number | null;
  avgFat: number | null;
  avgCarbs: number | null;
  /** 平均摂取カロリー - 目標カロリー(プラス = 超過) */
  calorieGap: number | null;
  /** 平均タンパク質 - 推奨タンパク質(マイナス = 不足) */
  proteinGap: number | null;

  // ---- 体重トレンド ----
  /** 直近の週あたり増減ペース(kg/週) */
  weeklyPace: number | null;
  /** トレンド算出に使った記録件数 */
  trendPoints: number;
  /** トレンドを維持した場合の目標達成予測日 */
  forecastDate: string | null;
  /** 予測が出せない理由(出せた場合は null) */
  forecastNote: string | null;

  // ---- トレーニング ----
  /** 直近 28 日のトレーニング日数 */
  workoutDaysLast28: number;
  /** 週あたりのトレーニング回数 */
  workoutsPerWeek: number | null;
};

/**
 * 集計済みデータから目標サポート分析を計算する。
 * データが足りない項目は null にして、呼び出し側で「—」表示にできるようにする。
 */
export function analyzeGoal(
  input: GoalAnalysisInput,
  today: string
): GoalAnalysis {
  const { goal, weights, bodyFats, bmrKcal, dailyNutrition } = input;

  // ---- 現在地(最新の記録)----
  const latestWeight = weights.length > 0 ? weights[weights.length - 1] : null;
  const latestBodyFat =
    bodyFats.length > 0 ? bodyFats[bodyFats.length - 1] : null;
  const currentWeight = latestWeight?.weight_kg ?? null;
  const currentBodyFat = latestBodyFat?.body_fat_percent ?? null;

  // ---- 目標との差分 ----
  const targetWeight = goal.target_weight_kg;
  const weightDiff =
    currentWeight != null && targetWeight != null
      ? round1(targetWeight - currentWeight)
      : null;
  const targetBodyFat = goal.target_body_fat_percent;
  const bodyFatDiff =
    currentBodyFat != null && targetBodyFat != null
      ? round1(targetBodyFat - currentBodyFat)
      : null;
  const targetDate = goal.target_date;
  const daysLeft = targetDate ? diffDays(today, targetDate) : null;

  // ---- 必要な 1 日あたりカロリー収支 ----
  // 体重差 × 7200kcal を残り日数で割る。期限切れ・当日は算出しない。
  const requiredDailyBalance =
    weightDiff != null && daysLeft != null && daysLeft > 0
      ? Math.round((weightDiff * KCAL_PER_KG) / daysLeft)
      : null;

  // メンテナンスカロリーは InBody の基礎代謝量があればそれを優先(活動係数 1.55)、
  // 無ければ体重 × 33kcal のざっくり推定を使う。
  let estimatedMaintenance: number | null = null;
  let maintenanceBasis: GoalAnalysis["maintenanceBasis"] = null;
  if (bmrKcal != null && bmrKcal > 0) {
    estimatedMaintenance = Math.round(bmrKcal * 1.55);
    maintenanceBasis = "inbody_bmr";
  } else if (currentWeight != null) {
    estimatedMaintenance = Math.round(currentWeight * 33);
    maintenanceBasis = "weight_estimate";
  }

  const targetDailyCalories =
    estimatedMaintenance != null
      ? Math.round(estimatedMaintenance + (requiredDailyBalance ?? 0))
      : null;

  const targetDailyProtein =
    currentWeight != null
      ? Math.round(currentWeight * PROTEIN_G_PER_KG)
      : null;

  // ---- 直近の食事傾向(記録がある日のみ平均する)----
  const avgCalories = average(dailyNutrition.map((d) => d.calories));
  const avgProtein = average(dailyNutrition.map((d) => d.protein_g));
  const avgFat = average(dailyNutrition.map((d) => d.fat_g));
  const avgCarbs = average(dailyNutrition.map((d) => d.carbs_g));

  const calorieGap =
    avgCalories != null && targetDailyCalories != null
      ? Math.round(avgCalories - targetDailyCalories)
      : null;
  const proteinGap =
    avgProtein != null && targetDailyProtein != null
      ? Math.round(avgProtein - targetDailyProtein)
      : null;

  // ---- 体重トレンド ----
  const trendFrom = addDays(today, -TREND_WINDOW_DAYS);
  const trendWeights = weights.filter((w) => w.date >= trendFrom);
  const slope = slopePerDay(
    trendWeights.map((w) => ({ date: w.date, value: w.weight_kg }))
  );
  const weeklyPace = slope != null ? round1(slope * 7) : null;

  // ---- 目標達成予測日 ----
  let forecastDate: string | null = null;
  let forecastNote: string | null = null;
  if (weightDiff == null) {
    forecastNote = "目標体重と体重の記録が必要です";
  } else if (Math.abs(weightDiff) < 0.1) {
    forecastDate = today;
    forecastNote = "すでに目標体重に到達しています";
  } else if (slope == null) {
    forecastNote = `直近${TREND_WINDOW_DAYS}日の体重記録が2件以上必要です`;
  } else if (Math.abs(slope) < 0.001) {
    forecastNote = "体重がほぼ横ばいのため予測できません";
  } else if (Math.sign(slope) !== Math.sign(weightDiff)) {
    forecastNote = "現在のペースは目標と逆方向に進んでいます";
  } else {
    const days = Math.ceil(weightDiff / slope);
    if (days > 3650) {
      forecastNote = "現在のペースでは10年以上かかる見込みです";
    } else {
      forecastDate = addDays(today, days);
    }
  }

  const workoutsPerWeek =
    input.workoutDaysLast28 > 0
      ? round1((input.workoutDaysLast28 / TREND_WINDOW_DAYS) * 7)
      : 0;

  return {
    today,
    mode: goal.mode,
    currentWeight,
    currentWeightDate: latestWeight?.date ?? null,
    currentBodyFat,
    currentBodyFatDate: latestBodyFat?.date ?? null,
    targetWeight,
    weightDiff,
    targetBodyFat,
    bodyFatDiff,
    targetDate,
    daysLeft,
    requiredDailyBalance,
    estimatedMaintenance,
    maintenanceBasis,
    targetDailyCalories,
    targetDailyProtein,
    nutritionDays: dailyNutrition.length,
    avgCalories: avgCalories != null ? Math.round(avgCalories) : null,
    avgProtein: avgProtein != null ? round1(avgProtein) : null,
    avgFat: avgFat != null ? round1(avgFat) : null,
    avgCarbs: avgCarbs != null ? round1(avgCarbs) : null,
    calorieGap,
    proteinGap,
    weeklyPace,
    trendPoints: trendWeights.length,
    forecastDate,
    forecastNote,
    workoutDaysLast28: input.workoutDaysLast28,
    workoutsPerWeek,
  };
}
