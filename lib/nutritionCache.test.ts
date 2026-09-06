import { describe, expect, it } from "vitest";
import {
  foodCacheKey,
  normalizeName,
  restaurantCacheKey,
} from "./nutritionCache";

/**
 * キャッシュのキーのテスト。
 *
 * ここがぶれると「同じ食品なのにキャッシュに当たらず毎回 AI を呼ぶ」ことになり、
 * 速度・料金・オフライン耐性のすべてが台無しになるので、細かく固定しておく。
 */
describe("normalizeName", () => {
  it("前後の空白を落とす", () => {
    expect(normalizeName("  豚バラ  ")).toBe("豚バラ");
  });

  it("連続する空白を 1 つにまとめる", () => {
    expect(normalizeName("鶏むね   皮なし")).toBe("鶏むね 皮なし");
  });

  it("全角の英数字を半角にそろえる", () => {
    expect(normalizeName("ＭＣＴオイル")).toBe("mctオイル");
  });

  it("半角カナを全角にそろえる", () => {
    expect(normalizeName("ﾋﾟｻﾞﾄｰｽﾄ")).toBe("ピザトースト");
  });

  it("英字の大文字小文字をそろえる", () => {
    expect(normalizeName("Pizza Toast")).toBe("pizza toast");
  });

  it("全角スペースも空白として扱う", () => {
    expect(normalizeName("豚バラ　スライス")).toBe("豚バラ スライス");
  });
});

describe("foodCacheKey", () => {
  it("書き方が違っても同じキーになる(= キャッシュに当たる)", () => {
    expect(foodCacheKey(" ピザトースト ")).toBe(foodCacheKey("ピザトースト"));
    expect(foodCacheKey("ﾋﾟｻﾞﾄｰｽﾄ")).toBe(foodCacheKey("ピザトースト"));
  });

  it("違う食品は違うキーになる", () => {
    expect(foodCacheKey("豚バラ")).not.toBe(foodCacheKey("豚ロース"));
  });
});

describe("restaurantCacheKey", () => {
  it("店名とメニュー名を区切って 1 つのキーにする", () => {
    expect(restaurantCacheKey("松屋", "牛丼特盛")).toBe("松屋|牛丼特盛");
  });

  it("表記ゆれを吸収する", () => {
    expect(restaurantCacheKey(" 松屋 ", "牛丼　特盛")).toBe(
      restaurantCacheKey("松屋", "牛丼 特盛")
    );
  });

  it("同じメニュー名でも店が違えば別のキーになる", () => {
    expect(restaurantCacheKey("松屋", "牛丼")).not.toBe(
      restaurantCacheKey("すき家", "牛丼")
    );
  });
});
