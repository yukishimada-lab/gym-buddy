"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CalendarDays, StickyNote } from "lucide-react";
import { VIZ } from "@/lib/viz";
import {
  WEEKDAY_LABELS,
  calendarCells,
  formatDateLabel,
  parseDate,
  shiftMonth,
  todayString,
  type YearMonth,
} from "@/lib/date";
import {
  formatNumber,
  hasMemo,
  memoText,
  sortLogs,
  sortSets,
  summaryLine,
} from "@/lib/workoutStats";
import { groupByMuscleGroup, normalizeMuscleGroup } from "@/lib/muscleGroups";
import ShareDaySummary from "@/components/ShareDaySummary";
import type {
  BodyLog,
  DaySummary,
  MealLog,
  WorkoutLogWithExercise,
} from "@/lib/types";

/**
 * 月表示のカレンダー。
 *
 * 色は dataviz スキルのカテゴリカルパレットから 2 スロットだけ使う:
 *   トレーニング = 青 (slot 1) / 食事記録 = オレンジ (slot 2)
 * 色覚に依存しないよう、マークの形も変えている(トレーニング = 塗りつぶし丸 /
 * 食事 = 輪郭だけの丸)。凡例もカレンダーのすぐ下に置く。
 */

const MARK = {
  workout: { color: VIZ.series1, tint: VIZ.series1Tint, label: "トレーニング" },
  meal: { color: VIZ.series2, tint: VIZ.series2Tint, label: "食事記録" },
} as const;

/** 凡例で使うマーク(カレンダー内のマークと同じ見た目) */
function WorkoutMark() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: MARK.workout.color }}
    />
  );
}

function MealMark() {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full border-2"
      style={{ borderColor: MARK.meal.color }}
    />
  );
}

/** カレンダーのマス目に出すマーク(記録の有無だけ) */
type DayMarks = { workout: boolean; meal: boolean };

function CalendarPage() {
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date") ?? todayString();

  const [ym, setYm] = useState<YearMonth>(() => {
    const d = parseDate(initialDate);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [selected, setSelected] = useState<string>(initialDate);
  const [summary, setSummary] = useState<Map<string, DayMarks>>(new Map());
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 選択した日の詳細
  const [dayLogs, setDayLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [dayMeals, setDayMeals] = useState<MealLog[]>([]);
  const [dayBody, setDayBody] = useState<BodyLog | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  const today = todayString();
  const cells = useMemo(() => calendarCells(ym), [ym]);

  /** 表示中の月に「トレーニング / 食事」の記録がある日を集める */
  const loadMonth = useCallback(async (target: YearMonth) => {
    setLoadingMonth(true);
    // カレンダーは前後の月の日もマス目に出るので、6 週間ぶんまとめて取得する
    const grid = calendarCells(target);
    const gridFrom = grid[0].date;
    const gridTo = grid[grid.length - 1].date;
    const supabase = createClient();
    const [workoutRes, mealRes] = await Promise.all([
      supabase
        .from("workout_logs")
        .select("workout_date")
        .gte("workout_date", gridFrom)
        .lte("workout_date", gridTo),
      supabase
        .from("meal_logs")
        .select("meal_date")
        .gte("meal_date", gridFrom)
        .lte("meal_date", gridTo),
    ]);

    if (workoutRes.error) {
      setError(`記録の取得に失敗しました: ${workoutRes.error.message}`);
      setLoadingMonth(false);
      return;
    }

    const map = new Map<string, DayMarks>();
    const mark = (date: string, key: keyof DayMarks) => {
      const current = map.get(date) ?? { workout: false, meal: false };
      current[key] = true;
      map.set(date, current);
    };
    for (const row of (workoutRes.data as { workout_date: string }[]) ?? []) {
      mark(row.workout_date, "workout");
    }
    // 食事記録は Phase 2 未セットアップでも動くよう、エラーは無視して色を付けないだけにする
    for (const row of (mealRes.data as { meal_date: string }[] | null) ?? []) {
      mark(row.meal_date, "meal");
    }
    setError(null);
    setSummary(map);
    setLoadingMonth(false);
  }, []);

  const loadDay = useCallback(async (date: string) => {
    setLoadingDay(true);
    const supabase = createClient();
    // 食事・からだは Phase 2 / 3 が未セットアップでも落ちないよう、エラーは無視して
    // 「記録なし」として扱う(トレーニングだけは失敗をエラー表示する)
    const [logRes, mealRes, bodyRes] = await Promise.all([
      supabase
        .from("workout_logs")
        .select("*, exercises(id, name, muscle_group), workout_sets(*)")
        .eq("workout_date", date),
      supabase.from("meal_logs").select("*").eq("meal_date", date),
      supabase.from("body_logs").select("*").eq("log_date", date).maybeSingle(),
    ]);
    setDayLogs(sortLogs((logRes.data as WorkoutLogWithExercise[]) ?? []));
    setDayMeals((mealRes.data as MealLog[]) ?? []);
    setDayBody((bodyRes.data as BodyLog | null) ?? null);
    setLoadingDay(false);
  }, []);

  useEffect(() => {
    (async () => {
      await loadMonth(ym);
    })();
  }, [ym, loadMonth]);

  useEffect(() => {
    (async () => {
      await loadDay(selected);
    })();
  }, [selected, loadDay]);

  const selectDay = (date: string) => {
    setSelected(date);
    const d = parseDate(date);
    // 前後の月の日をタップしたら、その月に移動する
    if (d.getFullYear() !== ym.year || d.getMonth() + 1 !== ym.month) {
      setYm({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
  };

  const mealTotal = useMemo(
    () =>
      dayMeals.reduce(
        (acc, m) => ({
          calories: acc.calories + Number(m.calories),
          protein_g: acc.protein_g + Number(m.protein_g),
          fat_g: acc.fat_g + Number(m.fat_g),
          carbs_g: acc.carbs_g + Number(m.carbs_g),
        }),
        { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }
      ),
    [dayMeals]
  );

  /**
   * その日の種目を部位ごとのセクションにまとめる。
   * 部位は「胸 → 背中 → 肩 → 腕 → 脚 → 体幹 → 有酸素 → その他」の固定順。
   * 種目マスタの部位が未設定でも、種目名から推定して振り分ける。
   */
  const sections = useMemo(
    () =>
      groupByMuscleGroup(dayLogs, (log) =>
        normalizeMuscleGroup(
          log.exercises?.muscle_group,
          log.exercises?.name ?? undefined
        )
      ),
    [dayLogs]
  );

  const daySummary: DaySummary = useMemo(
    () => ({
      date: selected,
      sections,
      meals: dayMeals,
      nutrition: mealTotal,
      body: dayBody,
    }),
    [selected, sections, dayMeals, mealTotal, dayBody]
  );

  const hasAnyRecord =
    dayLogs.length > 0 || dayMeals.length > 0 || dayBody !== null;

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <CalendarDays aria-hidden size={20} strokeWidth={2} />
          カレンダー
        </h1>
        <Link
          href="/history"
          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 active:bg-gray-200"
        >
          リストで見る ›
        </Link>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <section className="mb-3 rounded-xl bg-white p-3 shadow-sm">
        {/* 月の切り替え */}
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setYm(shiftMonth(ym, -1))}
            aria-label="前の月"
            className="rounded-lg px-3 py-2 text-lg leading-none text-gray-600 active:bg-gray-100"
          >
            ‹
          </button>
          <p className="text-base font-bold tabular-nums">
            {ym.year}年{ym.month}月
          </p>
          <button
            type="button"
            onClick={() => setYm(shiftMonth(ym, 1))}
            aria-label="次の月"
            className="rounded-lg px-3 py-2 text-lg leading-none text-gray-600 active:bg-gray-100"
          >
            ›
          </button>
        </div>

        {/* 曜日見出し(日曜始まり) */}
        <div className="grid grid-cols-7 text-center text-[11px] text-gray-500">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        {/* 日付のマス目 */}
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell) => {
            const day = summary.get(cell.date);
            const isSelected = cell.date === selected;
            const isToday = cell.date === today;
            const marks = [
              day?.workout ? MARK.workout.label : null,
              day?.meal ? MARK.meal.label : null,
            ].filter(Boolean);

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => selectDay(cell.date)}
                aria-pressed={isSelected}
                aria-label={`${formatDateLabel(cell.date)}${
                  marks.length > 0 ? ` ${marks.join("・")}あり` : " 記録なし"
                }`}
                className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-sm tabular-nums ${
                  cell.inMonth ? "" : "opacity-35"
                } ${
                  isSelected
                    ? "ring-2 ring-blue-600 ring-offset-1"
                    : isToday
                      ? "ring-1 ring-gray-400"
                      : ""
                }`}
                style={{
                  // 記録がある日は面で塗って一目で分かるようにする。
                  // 両方ある日はトレーニング(青)を優先し、食事は輪郭マークで示す。
                  backgroundColor: day?.workout
                    ? MARK.workout.tint
                    : day?.meal
                      ? MARK.meal.tint
                      : undefined,
                  color: VIZ.textPrimary,
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                <span className="leading-none">{cell.day}</span>
                {/* マークは色だけでなく形も変える(塗り = トレーニング / 輪郭 = 食事) */}
                <span className="flex h-2 items-center gap-0.5">
                  {day?.workout && <WorkoutMark />}
                  {day?.meal && <MealMark />}
                </span>
              </button>
            );
          })}
        </div>

        {/* 凡例 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <WorkoutMark />
            {MARK.workout.label}
          </span>
          <span className="flex items-center gap-1.5">
            <MealMark />
            {MARK.meal.label}
          </span>
          {loadingMonth && <span className="text-gray-400">読み込み中...</span>}
        </div>
      </section>

      {/* 選択した日の詳細 */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-bold">{formatDateLabel(selected)}</h2>

        {loadingDay ? (
          <p className="py-4 text-center text-sm text-gray-400">読み込み中...</p>
        ) : (
          <>
            <div className="mb-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <WorkoutMark />
                トレーニング({dayLogs.length}種目)
              </p>
              {dayLogs.length === 0 ? (
                <p className="text-sm text-gray-400">記録がありません</p>
              ) : (
                /* 部位ごとにセクション分けする(何をやった日か一目で分かるように) */
                <div className="space-y-3">
                  {sections.map((section) => (
                    <div key={section.group}>
                      <h3
                        className="mb-1 border-l-4 pl-2 text-xs font-bold"
                        style={{
                          borderColor: MARK.workout.color,
                          color: VIZ.textPrimary,
                        }}
                      >
                        {section.group}
                        <span className="ml-1 font-normal text-gray-500">
                          ({section.items.length}種目)
                        </span>
                      </h3>
                      <ul className="space-y-1">
                        {section.items.map((log) => (
                          <li key={log.id} className="text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-gray-700">
                                {log.exercises?.name ?? "(削除された種目)"}
                              </span>
                            </div>
                            {/* 数値が何を指すのかラベルを付ける */}
                            <p className="text-xs tabular-nums text-gray-500">
                              {summaryLine(sortSets(log.workout_sets ?? []))}
                            </p>
                            {/* その日その種目のメモ(あれば) */}
                            {hasMemo(log.memo) && (
                              <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-amber-900">
                                <StickyNote
                                  aria-hidden
                                  size={12}
                                  className="mt-0.5 shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  {memoText(log.memo)}
                                </span>
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <MealMark />
                食事({dayMeals.length}品)
              </p>
              {dayMeals.length === 0 ? (
                <p className="text-sm text-gray-400">記録がありません</p>
              ) : (
                <p className="text-sm tabular-nums text-gray-700">
                  {formatNumber(mealTotal.calories)}kcal · P{" "}
                  {formatNumber(mealTotal.protein_g, 1)}g / F{" "}
                  {formatNumber(mealTotal.fat_g, 1)}g / C{" "}
                  {formatNumber(mealTotal.carbs_g, 1)}g
                </p>
              )}
            </div>

            {dayBody && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold text-gray-600">
                  からだ
                </p>
                <p className="text-sm tabular-nums text-gray-700">
                  {[
                    dayBody.weight_kg != null &&
                      `体重 ${formatNumber(Number(dayBody.weight_kg), 1)}kg`,
                    dayBody.body_fat_percent != null &&
                      `体脂肪率 ${formatNumber(Number(dayBody.body_fat_percent), 1)}%`,
                    dayBody.skeletal_muscle_kg != null &&
                      `骨格筋量 ${formatNumber(Number(dayBody.skeletal_muscle_kg), 1)}kg`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "記録あり"}
                </p>
              </div>
            )}

            <div className="mb-2">
              <ShareDaySummary summary={daySummary} disabled={!hasAnyRecord} />
            </div>

            <div className="flex gap-2">
              <Link
                href={`/?date=${selected}`}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 text-center text-sm font-semibold text-white active:opacity-80"
              >
                記録を開く ›
              </Link>
              <Link
                href={`/meals?date=${selected}`}
                className="flex-1 rounded-lg bg-gray-100 py-2.5 text-center text-sm font-semibold text-gray-700 active:bg-gray-200"
              >
                食事を開く ›
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
