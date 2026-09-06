import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PIXELS, pixelRatioFor } from "./shareImage";

/**
 * 共有画像の精細さのテスト。
 *
 * iOS の canvas の面積制限を超えると、エラーも出ないまま真っ白な画像になる。
 * 気づきにくい壊れ方なので、上限に収まることを固定しておく。
 */
describe("pixelRatioFor", () => {
  it("ふつうの長さの日は 2 倍で書き出す(いちばんきれい)", () => {
    // 640 × 1,800 相当(6 種目の日)
    expect(pixelRatioFor(640, 1800)).toBe(2);
  });

  it("短い日ももちろん 2 倍", () => {
    expect(pixelRatioFor(640, 800)).toBe(2);
  });

  it("長すぎる日は倍率を落として、上限に収める", () => {
    const height = 12000; // 種目が非常に多い日
    const ratio = pixelRatioFor(640, height);
    expect(ratio).toBeLessThan(2);
    expect(640 * height * ratio ** 2).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
  });

  it("落とすときも 1 倍は下回らない(文字がつぶれて読めなくなるため)", () => {
    expect(pixelRatioFor(640, 1_000_000)).toBe(1);
  });

  it("倍率を落とすのは、本当に必要になったときだけ", () => {
    // ちょうど上限に収まる高さでは 2 倍のまま
    const height = Math.floor(MAX_IMAGE_PIXELS / (640 * 4));
    expect(pixelRatioFor(640, height)).toBe(2);
    expect(pixelRatioFor(640, height + 100)).toBeLessThan(2);
  });

  it("高さが 0 でも壊れない", () => {
    expect(pixelRatioFor(640, 0)).toBe(2);
  });
});
