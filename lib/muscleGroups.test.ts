import { describe, expect, it } from "vitest";
import { mainMuscleGroup } from "./muscleGroups";

/**
 * カレンダーのマスに出す「その日の主な部位」の判定。
 *
 * ひと目で「何の日だったか」が分かるかどうかがこの関数にかかっているので、
 * 同数のときの決まり方まで固定しておく。
 */
describe("mainMuscleGroup", () => {
  it("いちばん種目数が多い部位を返す", () => {
    expect(mainMuscleGroup(["背中", "背中", "背中", "腕", "腕"])).toEqual({
      group: "背中",
      hasOthers: true,
    });
  });

  it("1 部位だけの日は hasOthers が false", () => {
    expect(mainMuscleGroup(["脚", "脚"])).toEqual({
      group: "脚",
      hasOthers: false,
    });
  });

  it("同数なら表示順(胸 → 背中 → 肩 → 腕 → 脚 …)で先のものを採る", () => {
    expect(mainMuscleGroup(["腕", "胸"])?.group).toBe("胸");
    expect(mainMuscleGroup(["脚", "肩"])?.group).toBe("肩");
  });

  it("旧い区分や未設定の値も 8 区分にそろえて数える", () => {
    // 「腹」は「体幹」に読み替えられる
    expect(mainMuscleGroup(["腹", "体幹", "胸"])?.group).toBe("体幹");
  });

  it("記録が無ければ null", () => {
    expect(mainMuscleGroup([])).toBeNull();
  });
});
