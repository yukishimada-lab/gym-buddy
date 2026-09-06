import { describe, expect, it } from "vitest";
import {
  KCAL_PER_KG,
  addDays,
  analyzeGoal,
  diffDays,
  slopePerDay,
} from "./bodyAnalysis";
import type { GoalAnalysisInput } from "./types";

const TODAY = "2026-09-06";

/** 最低限の入力を作る(必要な項目だけ上書きする) */
function input(patch: Partial<GoalAnalysisInput> = {}): GoalAnalysisInput {
  return {
    goal: {
      mode: "cut",
      target_weight_kg: null,
      target_body_fat_percent: null,
      target_date: null,
    },
    weights: [],
    bodyFats: [],
    bmrKcal: null,
    dailyNutrition: [],
    workoutDaysLast28: 0,
    ...patch,
  };
}

describe("日付の計算", () => {
  it("日数差を出す", () => {
    expect(diffDays("2026-09-01", "2026-09-06")).toBe(5);
    expect(diffDays("2026-09-06", "2026-09-01")).toBe(-5);
  });

  it("月をまたいでも正しい", () => {
    expect(diffDays("2026-08-30", "2026-09-02")).toBe(3);
  });

  it("n 日後を出す", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-09-06", -28)).toBe("2026-08-09");
  });

  it("うるう年の 2 月をまたげる", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
  });
});

describe("slopePerDay", () => {
  it("1 日あたりの変化量を出す", () => {
    const slope = slopePerDay([
      { date: "2026-09-01", value: 70 },
      { date: "2026-09-11", value: 69 },
    ]);
    expect(slope).toBeCloseTo(-0.1);
  });

  it("ばらつきがあっても直線をあてはめる", () => {
    const slope = slopePerDay([
      { date: "2026-09-01", value: 70.2 },
      { date: "2026-09-02", value: 69.8 },
      { date: "2026-09-03", value: 70.0 },
      { date: "2026-09-04", value: 69.6 },
    ]);
    expect(slope).toBeLessThan(0);
  });

  it("記録が 1 件以下なら出せない", () => {
    expect(slopePerDay([{ date: "2026-09-01", value: 70 }])).toBeNull();
    expect(slopePerDay([])).toBeNull();
  });

  it("同じ日の記録しかなければ出せない", () => {
    expect(
      slopePerDay([
        { date: "2026-09-01", value: 70 },
        { date: "2026-09-01", value: 71 },
      ])
    ).toBeNull();
  });
});

describe("analyzeGoal: 現在地と目標の差", () => {
  it("いちばん新しい記録を現在地にする", () => {
    const result = analyzeGoal(
      input({
        weights: [
          { date: "2026-09-01", weight_kg: 72 },
          { date: "2026-09-05", weight_kg: 70.5 },
        ],
      }),
      TODAY
    );
    expect(result.currentWeight).toBe(70.5);
    expect(result.currentWeightDate).toBe("2026-09-05");
  });

  it("目標との差はプラスが「増やす」・マイナスが「減らす」", () => {
    const result = analyzeGoal(
      input({
        goal: {
          mode: "cut",
          target_weight_kg: 68,
          target_body_fat_percent: null,
          target_date: null,
        },
        weights: [{ date: "2026-09-05", weight_kg: 70.5 }],
      }),
      TODAY
    );
    expect(result.weightDiff).toBe(-2.5);
  });

  it("記録が無ければ null(画面では「—」になる)", () => {
    const result = analyzeGoal(input(), TODAY);
    expect(result.currentWeight).toBeNull();
    expect(result.weightDiff).toBeNull();
    expect(result.requiredDailyBalance).toBeNull();
  });
});

describe("analyzeGoal: 必要なカロリー収支", () => {
  it("体重差 × 7200kcal を残り日数で割る", () => {
    const result = analyzeGoal(
      input({
        goal: {
          mode: "cut",
          target_weight_kg: 68,
          target_body_fat_percent: null,
          target_date: "2026-10-06", // 30 日後
        },
        weights: [{ date: "2026-09-05", weight_kg: 70 }],
      }),
      TODAY
    );
    expect(result.daysLeft).toBe(30);
    // -2kg × 7200 / 30 日 = -480kcal/日
    expect(result.requiredDailyBalance).toBe(Math.round((-2 * KCAL_PER_KG) / 30));
  });

  it("期限が過ぎていたら算出しない", () => {
    const result = analyzeGoal(
      input({
        goal: {
          mode: "cut",
          target_weight_kg: 68,
          target_body_fat_percent: null,
          target_date: "2026-09-01",
        },
        weights: [{ date: "2026-09-05", weight_kg: 70 }],
      }),
      TODAY
    );
    expect(result.daysLeft).toBeLessThan(0);
    expect(result.requiredDailyBalance).toBeNull();
  });

  it("InBody の基礎代謝があればそれを優先する", () => {
    const result = analyzeGoal(
      input({ weights: [{ date: "2026-09-05", weight_kg: 70 }], bmrKcal: 1600 }),
      TODAY
    );
    expect(result.maintenanceBasis).toBe("inbody_bmr");
    expect(result.estimatedMaintenance).toBe(Math.round(1600 * 1.55));
  });

  it("基礎代謝が無ければ体重から概算する", () => {
    const result = analyzeGoal(
      input({ weights: [{ date: "2026-09-05", weight_kg: 70 }] }),
      TODAY
    );
    expect(result.maintenanceBasis).toBe("weight_estimate");
    expect(result.estimatedMaintenance).toBe(70 * 33);
  });

  it("推奨タンパク質は体重 × 2g", () => {
    const result = analyzeGoal(
      input({ weights: [{ date: "2026-09-05", weight_kg: 70 }] }),
      TODAY
    );
    expect(result.targetDailyProtein).toBe(140);
  });
});

describe("analyzeGoal: 食事の平均", () => {
  it("記録がある日だけで平均する", () => {
    const result = analyzeGoal(
      input({
        dailyNutrition: [
          { date: "2026-09-04", calories: 2000, protein_g: 120, fat_g: 60, carbs_g: 200 },
          { date: "2026-09-05", calories: 2400, protein_g: 140, fat_g: 70, carbs_g: 250 },
        ],
      }),
      TODAY
    );
    expect(result.nutritionDays).toBe(2);
    expect(result.avgCalories).toBe(2200);
    expect(result.avgProtein).toBe(130);
  });

  it("食事記録が無ければ null", () => {
    const result = analyzeGoal(input(), TODAY);
    expect(result.avgCalories).toBeNull();
    expect(result.calorieGap).toBeNull();
  });
});

describe("analyzeGoal: 目標達成の予測", () => {
  const goal = {
    mode: "cut" as const,
    target_weight_kg: 68,
    target_body_fat_percent: null,
    target_date: null,
  };

  it("今のペースが続いた場合の達成日を出す", () => {
    const result = analyzeGoal(
      input({
        goal,
        // 10 日で 1kg 減 = 1 日 0.1kg 減。残り 2kg なので 20 日後
        weights: [
          { date: "2026-08-27", weight_kg: 71 },
          { date: "2026-09-06", weight_kg: 70 },
        ],
      }),
      TODAY
    );
    expect(result.weeklyPace).toBe(-0.7);
    expect(result.forecastDate).toBe("2026-09-26");
    expect(result.forecastNote).toBeNull();
  });

  it("目標と逆方向に進んでいたら、そう伝える", () => {
    const result = analyzeGoal(
      input({
        goal,
        weights: [
          { date: "2026-08-27", weight_kg: 70 },
          { date: "2026-09-06", weight_kg: 71 },
        ],
      }),
      TODAY
    );
    expect(result.forecastDate).toBeNull();
    expect(result.forecastNote).toBe("現在のペースは目標と逆方向に進んでいます");
  });

  it("横ばいなら予測できないと伝える", () => {
    const result = analyzeGoal(
      input({
        goal,
        weights: [
          { date: "2026-08-27", weight_kg: 70 },
          { date: "2026-09-06", weight_kg: 70 },
        ],
      }),
      TODAY
    );
    expect(result.forecastNote).toBe("体重がほぼ横ばいのため予測できません");
  });

  it("すでに達成していたら、そう伝える", () => {
    const result = analyzeGoal(
      input({ goal, weights: [{ date: "2026-09-06", weight_kg: 68 }] }),
      TODAY
    );
    expect(result.forecastDate).toBe(TODAY);
    expect(result.forecastNote).toBe("すでに目標体重に到達しています");
  });

  it("28 日より古い記録はトレンドに使わない", () => {
    const result = analyzeGoal(
      input({
        goal,
        weights: [
          { date: "2026-01-01", weight_kg: 80 }, // 古すぎるので無視される
          { date: "2026-09-06", weight_kg: 70 },
        ],
      }),
      TODAY
    );
    expect(result.trendPoints).toBe(1);
    expect(result.forecastNote).toBe("直近28日の体重記録が2件以上必要です");
  });
});

describe("analyzeGoal: トレーニング頻度", () => {
  it("28 日の日数から週あたりに換算する", () => {
    const result = analyzeGoal(input({ workoutDaysLast28: 12 }), TODAY);
    expect(result.workoutsPerWeek).toBe(3);
  });

  it("記録が無ければ 0", () => {
    expect(analyzeGoal(input(), TODAY).workoutsPerWeek).toBe(0);
  });
});
