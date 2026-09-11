import { describe, expect, it } from "vitest";
import {
  buildPreviousMemoMap,
  buildPreviousRecordMap,
  compareMetric,
  compareWithPrevious,
  formatSets,
  formatWeight,
  hasMemo,
  hasWeight,
  maxWeight,
  memoText,
  sameSets,
  sortSets,
  summarize,
  summaryLine,
  toSetInputs,
  toSetRows,
  totalReps,
  totalVolume,
  type SetLike,
} from "./workoutStats";
import type { WorkoutSet } from "./types";

/** 「80kg×10回」のようなセットを作る */
function set(weight_kg: number | string, reps: number | string): SetLike {
  return { weight_kg, reps };
}

/** 記録の例: 80kg×10回 / 80kg×8回 / 70kg×8回 */
const SETS = [set(80, 10), set(80, 8), set(70, 8)];

describe("集計", () => {
  it("最大重量はいちばん重いセットの重量", () => {
    expect(maxWeight(SETS)).toBe(80);
  });

  it("総ボリュームは 重量 × 回数 の合計", () => {
    // 800 + 640 + 560
    expect(totalVolume(SETS)).toBe(2000);
  });

  it("総レップ数は回数の合計", () => {
    expect(totalReps(SETS)).toBe(26);
  });

  it("入力途中の文字列でも数値として集計できる", () => {
    expect(totalVolume([set("60", "10")])).toBe(600);
    expect(maxWeight([set("", "10")])).toBe(0);
  });

  it("セットが空なら 0", () => {
    expect(summarize([])).toEqual({
      setCount: 0,
      maxWeight: 0,
      totalVolume: 0,
      totalReps: 0,
    });
  });
});

describe("hasWeight", () => {
  it("1 セットでも重量が入っていれば true", () => {
    expect(hasWeight([set(0, 10), set(60, 8)])).toBe(true);
  });

  it("自重種目(重量なし)は false", () => {
    expect(hasWeight([set(0, 10), set("", 8)])).toBe(false);
  });
});

describe("summaryLine", () => {
  it("重量が入っていればラベル付きで要約する", () => {
    expect(summaryLine(SETS)).toBe("3セット · 最大80kg · 総ボリューム2,000kg");
  });

  it("重量が無い記録を「0kg」と出さない(誤解を招くため)", () => {
    expect(summaryLine([set(0, 10), set(0, 10), set(0, 10)])).toBe(
      "3セット · 重量なし · 計30回"
    );
  });

  it("セットが無ければ未入力と出す", () => {
    expect(summaryLine([])).toBe("セット未入力");
  });
});

describe("formatSets", () => {
  it("重量×回数を並べる", () => {
    expect(formatSets(SETS)).toBe("80kg×10回 / 80kg×8回 / 70kg×8回");
  });

  it("重量が無ければ回数だけを出す", () => {
    expect(formatSets([set(0, 10), set(0, 8)])).toBe("10回 / 8回(重量なし)");
  });
});

describe("formatWeight", () => {
  it("整数には小数を付けない", () => {
    expect(formatWeight(80)).toBe("80");
  });

  it("小数はそのまま出す", () => {
    expect(formatWeight(82.5)).toBe("82.5");
  });
});

describe("compareMetric", () => {
  it("増えていれば up", () => {
    expect(compareMetric(82.5, 80).direction).toBe("up");
  });

  it("減っていれば down", () => {
    expect(compareMetric(77.5, 80).direction).toBe("down");
  });

  it("同じなら same", () => {
    expect(compareMetric(80, 80).direction).toBe("same");
  });

  it("浮動小数の誤差は同値として扱う(色がちらつかないように)", () => {
    expect(compareMetric(0.1 + 0.2, 0.3).direction).toBe("same");
  });

  it("差分を返す", () => {
    expect(compareMetric(82.5, 80).delta).toBeCloseTo(2.5);
  });
});

describe("compareWithPrevious", () => {
  it("前回記録が無ければ null(= 色を付けない)", () => {
    expect(compareWithPrevious(SETS, null)).toBeNull();
  });

  it("最大重量と総ボリュームの両方を比べる", () => {
    const result = compareWithPrevious(SETS, {
      date: "2026-09-01",
      sets: [set(75, 10), set(75, 8)],
    });
    expect(result?.previousDate).toBe("2026-09-01");
    expect(result?.maxWeight.direction).toBe("up");
    expect(result?.totalVolume.direction).toBe("up");
  });

  it("重量は伸びてもボリュームが落ちていれば、それぞれ別に出る", () => {
    const result = compareWithPrevious([set(85, 3)], {
      date: "2026-09-01",
      sets: [set(80, 10), set(80, 10)],
    });
    expect(result?.maxWeight.direction).toBe("up");
    expect(result?.totalVolume.direction).toBe("down");
  });
});

/** DB から来るセット行を作る */
function dbSet(set_number: number, weight_kg: number, reps: number): WorkoutSet {
  return {
    id: `s${set_number}`,
    workout_log_id: "log",
    set_number,
    weight_kg,
    reps,
    created_at: "2026-09-01T00:00:00Z",
  };
}

describe("sortSets", () => {
  it("セット番号の順にそろえる", () => {
    const sorted = sortSets([dbSet(3, 70, 8), dbSet(1, 80, 10), dbSet(2, 80, 8)]);
    expect(sorted.map((s) => s.set_number)).toEqual([1, 2, 3]);
  });

  it("元の配列を書き換えない", () => {
    const original = [dbSet(2, 80, 8), dbSet(1, 80, 10)];
    sortSets(original);
    expect(original.map((s) => s.set_number)).toEqual([2, 1]);
  });
});

describe("buildPreviousRecordMap", () => {
  it("種目ごとに、いちばん新しい記録を採用する", () => {
    const map = buildPreviousRecordMap([
      { exercise_id: "bench", workout_date: "2026-09-03", workout_sets: [dbSet(1, 80, 10)] },
      { exercise_id: "bench", workout_date: "2026-08-30", workout_sets: [dbSet(1, 75, 10)] },
      { exercise_id: "squat", workout_date: "2026-09-02", workout_sets: [dbSet(1, 100, 5)] },
    ]);
    expect(map.get("bench")?.date).toBe("2026-09-03");
    expect(map.get("squat")?.date).toBe("2026-09-02");
  });

  it("セットが 1 つも無い記録は比較対象にしない", () => {
    const map = buildPreviousRecordMap([
      { exercise_id: "bench", workout_date: "2026-09-03", workout_sets: [] },
      { exercise_id: "bench", workout_date: "2026-08-30", workout_sets: [dbSet(1, 75, 10)] },
    ]);
    expect(map.get("bench")?.date).toBe("2026-08-30");
  });

  it("記録が無い種目は入らない", () => {
    expect(buildPreviousRecordMap([]).size).toBe(0);
  });
});

describe("メモ", () => {
  it("空白だけのメモは無いものとして扱う", () => {
    expect(hasMemo("   ")).toBe(false);
    expect(hasMemo(null)).toBe(false);
    expect(hasMemo("肘が痛い")).toBe(true);
    expect(memoText("  肘が痛い  ")).toBe("肘が痛い");
  });

  it("種目ごとに、いちばん新しい「空でないメモ」を拾う", () => {
    const map = buildPreviousMemoMap([
      { exercise_id: "bench", workout_date: "2026-09-03", memo: "  " },
      { exercise_id: "bench", workout_date: "2026-08-30", memo: "次回は+2.5kg" },
    ]);
    expect(map.get("bench")).toEqual({
      date: "2026-08-30",
      memo: "次回は+2.5kg",
    });
  });
});

describe("toSetInputs(DB → 入力欄)", () => {
  it("重量が入っている記録はそのまま出す", () => {
    expect(toSetInputs([dbSet(1, 80, 10)])).toEqual([
      { id: "s1", weight_kg: "80", reps: "10" },
    ]);
  });

  it("0 は空欄で出す(打つ前に 0 を消す手間をなくすため)", () => {
    expect(toSetInputs([dbSet(1, 0, 10)])).toEqual([
      { id: "s1", weight_kg: "", reps: "10" },
    ]);
    expect(toSetInputs([dbSet(1, 0, 0)])).toEqual([
      { id: "s1", weight_kg: "", reps: "" },
    ]);
  });

  it("セット番号の順にそろえる", () => {
    const inputs = toSetInputs([dbSet(2, 70, 8), dbSet(1, 80, 10)]);
    expect(inputs.map((s) => s.weight_kg)).toEqual(["80", "70"]);
  });

  it("余計な小数を出さない(80.0 ではなく 80)", () => {
    expect(toSetInputs([dbSet(1, 80.0, 10)])[0].weight_kg).toBe("80");
    expect(toSetInputs([dbSet(1, 82.5, 10)])[0].weight_kg).toBe("82.5");
  });
});

describe("toSetRows(入力欄 → DB)", () => {
  it("空欄は 0 として保存する(空欄で出したものが往復しても壊れない)", () => {
    expect(toSetRows([{ id: null, weight_kg: "", reps: "" }])).toEqual([
      { set_number: 1, weight_kg: 0, reps: 0 },
    ]);
  });

  it("セット番号を 1 から振り直す", () => {
    const rows = toSetRows([
      { id: null, weight_kg: "80", reps: "10" },
      { id: null, weight_kg: "70", reps: "8" },
    ]);
    expect(rows.map((r) => r.set_number)).toEqual([1, 2]);
  });

  it("空欄で出した記録を保存し直しても、また空欄で開ける", () => {
    const rows = toSetRows(toSetInputs([dbSet(1, 0, 10)]));
    expect(rows).toEqual([{ set_number: 1, weight_kg: 0, reps: 10 }]);
    expect(toSetInputs([dbSet(1, rows[0].weight_kg, rows[0].reps)])[0]).toEqual({
      id: "s1",
      weight_kg: "",
      reps: "10",
    });
  });
});

describe("sameSets", () => {
  it("セット数・重量・回数がすべて同じなら true", () => {
    expect(sameSets(SETS, [set(80, 10), set(80, 8), set(70, 8)])).toBe(true);
  });

  it("セット数が違えば false", () => {
    expect(sameSets(SETS, [set(80, 10), set(80, 8)])).toBe(false);
  });

  it("1 つでも重量か回数が違えば false", () => {
    expect(sameSets(SETS, [set(80, 10), set(80, 8), set(70, 9)])).toBe(false);
    expect(sameSets(SETS, [set(80, 10), set(82.5, 8), set(70, 8)])).toBe(false);
  });

  it("数値と文字列が混ざっていても同じ値なら true(入力途中の値と比べるため)", () => {
    expect(sameSets([set("80", "10")], [set(80, 10)])).toBe(true);
  });

  it("空欄と 0 は同じ扱い(どちらも「入力なし」)", () => {
    expect(sameSets([set("", "10")], [set(0, 10)])).toBe(true);
  });

  it("どちらも空なら true", () => {
    expect(sameSets([], [])).toBe(true);
  });
});
