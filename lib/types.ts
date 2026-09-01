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
