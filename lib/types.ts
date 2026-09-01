export type Exercise = {
  id: string;
  user_id: string;
  name: string;
  muscle_group: string | null;
  created_at: string;
};

/**
 * ワークアウト記録(種目 1 つ分)。
 *
 * Phase 4 から実際の中身は子テーブル workout_sets(セットごとの重量・回数)が持つ。
 * weight_kg / reps / sets は Phase 3 までの旧カラムで、
 * 互換のためにセット内容から自動集計された値(最大重量・最大回数・セット数)が入る。
 * 画面表示には使わないこと。
 */
export type WorkoutLog = {
  id: string;
  user_id: string;
  workout_date: string; // YYYY-MM-DD
  exercise_id: string;
  /** @deprecated 旧カラム(セットの最大重量が自動で入る)。表示には workout_sets を使う */
  weight_kg: number;
  /** @deprecated 旧カラム(セットの最大回数が自動で入る)。表示には workout_sets を使う */
  reps: number;
  /** @deprecated 旧カラム(セット数が自動で入る)。表示には workout_sets を使う */
  sets: number;
  memo: string | null;
  sort_order: number;
  created_at: string;
};

/** セットごとの記録(1セット目 80kg×10回、2セット目 80kg×8回 …) */
export type WorkoutSet = {
  id: string;
  workout_log_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  created_at: string;
};

/** exercises と workout_sets を JOIN した表示用の型 */
export type WorkoutLogWithExercise = WorkoutLog & {
  exercises: Pick<Exercise, "id" | "name" | "muscle_group"> | null;
  workout_sets: WorkoutSet[];
};

/** 入力中のセット(保存前は文字列で持つ) */
export type SetInput = {
  /** 既存セットなら DB の id、追加したセットは null */
  id: string | null;
  weight_kg: string;
  reps: string;
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

/**
 * からだの記録(1 日 1 件)。
 *
 * Phase 4 で weight_logs と inbody_logs を body_logs に統合した。
 * 体重が主役(アプリ上は必須入力)で、InBody の各項目はすべて任意。
 * weight_kg が null になり得るのは、体重の入っていない旧 InBody 記録を
 * 取りこぼさずに移行したレコードだけ。
 */
export type BodyLog = {
  id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
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
