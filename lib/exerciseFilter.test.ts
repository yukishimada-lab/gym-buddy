import { describe, expect, it } from "vitest";
import {
  filterExercises,
  groupCounts,
  sortExercises,
  type FilterableExercise,
} from "./exerciseFilter";

/** テスト用の種目(id は名前から作る) */
function ex(name: string, muscle_group: string | null = null): FilterableExercise {
  return { id: name, name, muscle_group };
}

const EXERCISES: FilterableExercise[] = [
  ex("ベンチプレス", "胸"),
  ex("インクラインベンチプレス", "胸"),
  ex("デッドリフト", "背中"),
  ex("ラットプルダウン", "背中"),
  ex("サイドレイズ", "肩"),
  ex("スクワット", "脚"),
  ex("ランニング", "有酸素"),
];

describe("filterExercises", () => {
  it("部位で絞り込む", () => {
    const names = filterExercises(EXERCISES, { group: "胸" }).map((e) => e.name);
    expect(names).toEqual(["インクラインベンチプレス", "ベンチプレス"]);
  });

  it("名前の一部で検索できる", () => {
    const names = filterExercises(EXERCISES, { query: "ベンチ" }).map((e) => e.name);
    expect(names).toEqual(["インクラインベンチプレス", "ベンチプレス"]);
  });

  it("スペース区切りは AND 条件で、部位名にも当たる", () => {
    const names = filterExercises(EXERCISES, { query: "背中 プル" }).map((e) => e.name);
    expect(names).toEqual(["ラットプルダウン"]);
  });

  it("大文字小文字と全角スペースの違いを吸収する", () => {
    const list = [ex("EZバーカール", "腕"), ex("スクワット", "脚")];
    expect(filterExercises(list, { query: "ez" }).map((e) => e.name)).toEqual([
      "EZバーカール",
    ]);
    expect(filterExercises(list, { query: "腕　ez" }).map((e) => e.name)).toEqual([
      "EZバーカール",
    ]);
  });

  it("部位と検索語は同時に効く", () => {
    const names = filterExercises(EXERCISES, { group: "胸", query: "インクライン" });
    expect(names.map((e) => e.name)).toEqual(["インクラインベンチプレス"]);
  });

  it("条件なしなら全件を並べ替えて返す", () => {
    expect(filterExercises(EXERCISES)).toHaveLength(EXERCISES.length);
  });

  it("該当が無ければ空を返す", () => {
    expect(filterExercises(EXERCISES, { query: "存在しない種目" })).toEqual([]);
  });

  it("部位が未設定でも種目名から推定して絞り込める", () => {
    const list = [ex("ベンチプレス"), ex("スクワット")];
    expect(filterExercises(list, { group: "胸" }).map((e) => e.name)).toEqual([
      "ベンチプレス",
    ]);
  });
});

describe("sortExercises", () => {
  it("部位の順(胸→背中→肩→腕→脚→体幹→有酸素→その他)、同じ部位なら名前順", () => {
    const names = sortExercises(EXERCISES).map((e) => e.name);
    expect(names).toEqual([
      "インクラインベンチプレス",
      "ベンチプレス",
      "デッドリフト",
      "ラットプルダウン",
      "サイドレイズ",
      "スクワット",
      "ランニング",
    ]);
  });

  it("元の配列を書き換えない", () => {
    const original = [...EXERCISES];
    sortExercises(EXERCISES);
    expect(EXERCISES).toEqual(original);
  });
});

describe("groupCounts", () => {
  it("種目がある部位だけを、表示順と件数つきで返す", () => {
    expect(groupCounts(EXERCISES)).toEqual([
      { group: "胸", count: 2 },
      { group: "背中", count: 2 },
      { group: "肩", count: 1 },
      { group: "脚", count: 1 },
      { group: "有酸素", count: 1 },
    ]);
  });

  it("種目が無ければ空(フィルタのボタン自体を出さない)", () => {
    expect(groupCounts([])).toEqual([]);
  });
});
