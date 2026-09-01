import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NUTRITION_WINDOW_DAYS,
  TREND_WINDOW_DAYS,
  addDays,
} from "@/lib/bodyAnalysis";
import type { BodyGoal, GoalAnalysisInput, GoalMode } from "@/lib/types";

/**
 * 目標サポート分析に必要なデータを Supabase からまとめて取得する。
 * ブラウザ用クライアント / サーバー用クライアントのどちらからも呼べるように
 * SupabaseClient を引数で受け取る(RLS により自分のデータだけが返る)。
 */
export async function loadGoalAnalysisInput(
  supabase: SupabaseClient,
  today: string
): Promise<GoalAnalysisInput> {
  // 体重・体脂肪率のトレンドは余裕をみて 180 日分取得する
  const trendFrom = addDays(today, -180);
  const nutritionFrom = addDays(today, -(NUTRITION_WINDOW_DAYS - 1));
  const workoutFrom = addDays(today, -(TREND_WINDOW_DAYS - 1));

  const [goalRes, weightRes, inbodyRes, mealRes, workoutRes] =
    await Promise.all([
      supabase.from("body_goals").select("*").maybeSingle(),
      supabase
        .from("weight_logs")
        .select("log_date, weight_kg")
        .gte("log_date", trendFrom)
        .lte("log_date", today)
        .order("log_date", { ascending: true }),
      supabase
        .from("inbody_logs")
        .select("measured_date, body_fat_percent, bmr_kcal")
        .gte("measured_date", trendFrom)
        .lte("measured_date", today)
        .order("measured_date", { ascending: true }),
      supabase
        .from("meal_logs")
        .select("meal_date, calories, protein_g, fat_g, carbs_g")
        .gte("meal_date", nutritionFrom)
        .lte("meal_date", today),
      supabase
        .from("workout_logs")
        .select("workout_date")
        .gte("workout_date", workoutFrom)
        .lte("workout_date", today),
    ]);

  const goalRow = (goalRes.data as BodyGoal | null) ?? null;

  const weights = ((weightRes.data as
    | { log_date: string; weight_kg: number }[]
    | null) ?? []).map((row) => ({
    date: row.log_date,
    weight_kg: Number(row.weight_kg),
  }));

  const inbodyRows = (inbodyRes.data as
    | {
        measured_date: string;
        body_fat_percent: number | null;
        bmr_kcal: number | null;
      }[]
    | null) ?? [];

  const bodyFats = inbodyRows
    .filter((row) => row.body_fat_percent != null)
    .map((row) => ({
      date: row.measured_date,
      body_fat_percent: Number(row.body_fat_percent),
    }));

  // 基礎代謝量は記録がある中で最新のものを使う(日付昇順で取得済み)
  const bmrRow = [...inbodyRows].reverse().find((row) => row.bmr_kcal != null);
  const bmrKcal = bmrRow ? Number(bmrRow.bmr_kcal) : null;

  // 食事記録は日別に合計する(記録がある日だけを平均対象にする)
  const nutritionMap = new Map<
    string,
    { calories: number; protein_g: number; fat_g: number; carbs_g: number }
  >();
  for (const row of (mealRes.data as
    | {
        meal_date: string;
        calories: number;
        protein_g: number;
        fat_g: number;
        carbs_g: number;
      }[]
    | null) ?? []) {
    const acc = nutritionMap.get(row.meal_date) ?? {
      calories: 0,
      protein_g: 0,
      fat_g: 0,
      carbs_g: 0,
    };
    acc.calories += Number(row.calories);
    acc.protein_g += Number(row.protein_g);
    acc.fat_g += Number(row.fat_g);
    acc.carbs_g += Number(row.carbs_g);
    nutritionMap.set(row.meal_date, acc);
  }
  const dailyNutrition = [...nutritionMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const workoutDays = new Set(
    ((workoutRes.data as { workout_date: string }[] | null) ?? []).map(
      (row) => row.workout_date
    )
  );

  return {
    goal: {
      mode: (goalRow?.mode as GoalMode) ?? "maintain",
      target_weight_kg:
        goalRow?.target_weight_kg != null
          ? Number(goalRow.target_weight_kg)
          : null,
      target_body_fat_percent:
        goalRow?.target_body_fat_percent != null
          ? Number(goalRow.target_body_fat_percent)
          : null,
      target_date: goalRow?.target_date ?? null,
    },
    weights,
    bodyFats,
    bmrKcal,
    dailyNutrition,
    workoutDaysLast28: workoutDays.size,
  };
}
