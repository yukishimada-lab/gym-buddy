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

// ------------------------------------------------------------
// Phase 3: 体重・InBody データの記録と目標サポート
// ------------------------------------------------------------

/** 体重記録(1 日 1 件) */
export type WeightLog = {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  weight_kg: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * InBody 記録(測定日ごと)。
 * 測定機器や測定内容によって入力できる項目が違うため、数値項目はすべて任意。
 */
export type InbodyLog = {
  id: string;
  user_id: string;
  measured_date: string; // YYYY-MM-DD
  weight_kg: number | null;
  body_fat_percent: number | null;
  skeletal_muscle_kg: number | null;
  body_fat_mass_kg: number | null;
  bmr_kcal: number | null;
  body_water_l: number | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

/** 目標のモード */
export type GoalMode = "bulk" | "cut" | "maintain";

/** 目標設定(1 ユーザー 1 件) */
export type BodyGoal = {
  id: string;
  user_id: string;
  mode: GoalMode;
  target_weight_kg: number | null;
  target_body_fat_percent: number | null;
  target_date: string | null; // YYYY-MM-DD
  memo: string | null;
  created_at: string;
  updated_at: string;
};

/** 推移グラフ 1 点分(値が無い日は null にして線を途切れさせる) */
export type BodyTrendPoint = {
  date: string; // YYYY-MM-DD
  weight_kg: number | null;
  body_fat_percent: number | null;
  skeletal_muscle_kg: number | null;
};

/** 目標サポート分析に渡す、集計済みの数値データ */
export type GoalAnalysisInput = {
  goal: {
    mode: GoalMode;
    target_weight_kg: number | null;
    target_body_fat_percent: number | null;
    target_date: string | null;
  };
  /** 直近の体重(日付昇順) */
  weights: { date: string; weight_kg: number }[];
  /** 直近の体脂肪率(日付昇順・記録がある日のみ) */
  bodyFats: { date: string; body_fat_percent: number }[];
  /** 直近の基礎代謝量(kcal / InBody 由来・最新値) */
  bmrKcal: number | null;
  /** 直近の食事記録の日別集計(記録がある日のみ) */
  dailyNutrition: {
    date: string;
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  }[];
  /** 直近 28 日でトレーニングした日数 */
  workoutDaysLast28: number;
};
