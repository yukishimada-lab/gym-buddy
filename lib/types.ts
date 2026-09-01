export type Exercise = {
  id: string;
  user_id: string;
  name: string;
  muscle_group: string | null;
  created_at: string;
};

export type WorkoutLog = {
  id: string;
  user_id: string;
  workout_date: string; // YYYY-MM-DD
  exercise_id: string;
  weight_kg: number;
  reps: number;
  sets: number;
  memo: string | null;
  created_at: string;
};

/** exercises を JOIN した表示用の型 */
export type WorkoutLogWithExercise = WorkoutLog & {
  exercises: Pick<Exercise, "id" | "name" | "muscle_group"> | null;
};

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type RoutineItem = {
  id: string;
  routine_id: string;
  exercise_id: string;
  default_weight_kg: number | null;
  default_reps: number;
  default_sets: number;
  sort_order: number;
};

export type RoutineItemWithExercise = RoutineItem & {
  exercises: Pick<Exercise, "id" | "name" | "muscle_group"> | null;
};

export type RoutineWithItems = Routine & {
  routine_items: RoutineItemWithExercise[];
};

// ------------------------------------------------------------
// Phase 2: 食事管理と PFC 計算
// ------------------------------------------------------------

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

/** 食品マスタ(PFC・カロリーはすべて 100g あたり) */
export type FoodItem = {
  id: string;
  user_id: string | null; // null = 全ユーザー共通マスタ
  name: string;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  calories: number;
  created_at: string;
};

/** 食事記録(PFC・カロリーは「そのグラム数での値」を保存) */
export type MealLog = {
  id: string;
  user_id: string;
  meal_date: string; // YYYY-MM-DD
  meal_type: MealType;
  food_item_id: string | null;
  food_name: string;
  amount_g: number | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  calories: number;
  photo_path: string | null;
  created_at: string;
};

/** Gemini(写真解析・外食検索)が返す 1 品目分の推定値 */
export type EstimatedFoodItem = {
  food_name: string;
  amount_g: number | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  calories: number;
};
