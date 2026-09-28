import { describe, expect, it } from "vitest";
import {
  buildDayMarks,
  countRoutineDaysInMonth,
  type MonthWorkoutRow,
} from "./calendarMarks";

const rows: MonthWorkoutRow[] = [
  { date: "2026-09-01", group: "胸", routineId: "chest" },
  { date: "2026-09-01", group: "胸", routineId: "chest" },
  { date: "2026-09-01", group: "肩", routineId: "chest" },
  { date: "2026-09-03", group: "脚", routineId: "leg" },
  { date: "2026-09-05", group: "背中", routineId: null },
  // 前後の月のマス目にも出る日(月またぎ)
  { date: "2026-08-31", group: "脚", routineId: "leg" },
  { date: "2026-10-01", group: "脚", routineId: "leg" },
];

describe("buildDayMarks", () => {
  it("絞り込まないときは、すべての記録に印を付ける", () => {
    const marks = buildDayMarks(rows, ["2026-09-02"], null);
    expect(marks.get("2026-09-01")?.workout).toBe(true);
    expect(marks.get("2026-09-03")?.workout).toBe(true);
    expect(marks.get("2026-09-05")?.workout).toBe(true);
    expect(marks.get("2026-09-02")?.meal).toBe(true);
  });

  it("その日の主な部位(いちばん多い部位)を返す", () => {
    const marks = buildDayMarks(rows, [], null);
    // 9/1 は 胸 2・肩 1 なので「胸」、ほかの部位もあるので「+」が付く
    expect(marks.get("2026-09-01")?.group).toBe("胸");
    expect(marks.get("2026-09-01")?.hasOtherGroups).toBe(true);
    // 9/3 は 脚 だけ
    expect(marks.get("2026-09-03")?.group).toBe("脚");
    expect(marks.get("2026-09-03")?.hasOtherGroups).toBe(false);
  });

  it("ルーティンで絞り込むと、そのルーティンの日だけが残る", () => {
    const marks = buildDayMarks(rows, ["2026-09-02"], "leg");
    expect(marks.get("2026-09-03")?.workout).toBe(true);
    expect(marks.has("2026-09-01")).toBe(false);
    // ルーティンに紐づいていない記録(手で足した記録)は出ない
    expect(marks.has("2026-09-05")).toBe(false);
  });

  it("絞り込み中は食事の印を出さない(数えられなくなるため)", () => {
    const marks = buildDayMarks(rows, ["2026-09-02"], "leg");
    expect(marks.has("2026-09-02")).toBe(false);
  });

  it("絞り込んでも、その日の主な部位は出す", () => {
    const marks = buildDayMarks(rows, [], "chest");
    expect(marks.get("2026-09-01")?.group).toBe("胸");
  });
});

describe("countRoutineDaysInMonth", () => {
  it("その月の日だけを、日付の重複なしで数える", () => {
    // leg は 8/31・9/3・10/1 にあるが、9 月として数えるのは 9/3 の 1 日だけ
    expect(countRoutineDaysInMonth(rows, "leg", 2026, 9)).toBe(1);
  });

  it("同じ日に複数種目あっても 1 日と数える", () => {
    // chest は 9/1 に 3 種目あるが 1 日
    expect(countRoutineDaysInMonth(rows, "chest", 2026, 9)).toBe(1);
  });

  it("1 桁の月でも取り違えない", () => {
    const august: MonthWorkoutRow[] = [
      { date: "2026-08-31", group: "脚", routineId: "leg" },
    ];
    expect(countRoutineDaysInMonth(august, "leg", 2026, 8)).toBe(1);
    expect(countRoutineDaysInMonth(august, "leg", 2026, 9)).toBe(0);
  });
});
