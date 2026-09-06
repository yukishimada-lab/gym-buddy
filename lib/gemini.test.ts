import { describe, expect, it } from "vitest";
import { rankModels } from "./gemini";

/**
 * モデル選定のテスト。
 *
 * 2026 年 9 月に、コードに直書きしていたモデル名 3 つが同時に提供終了して
 * AI 機能が全滅した。その再発防止として「使えるモデルを一覧から選ぶ」ように
 * したので、その選び方が意図どおりかをここで固定する。
 */
describe("rankModels", () => {
  it("文章生成に使えないモデル(埋め込み・画像生成・音声)を除く", () => {
    const models = rankModels([
      { name: "models/text-embedding-004" },
      { name: "models/imagen-4.0-generate-001" },
      { name: "models/gemini-2.5-flash-image" },
      { name: "models/gemini-2.5-flash-tts" },
      { name: "models/veo-3.0-generate-001" },
      { name: "models/gemini-2.5-flash" },
    ]);
    expect(models).toEqual(["gemini-2.5-flash"]);
  });

  it("同じ世代なら flash を pro より優先する(速くて安いため)", () => {
    const models = rankModels([
      { name: "models/gemini-2.5-pro" },
      { name: "models/gemini-2.5-flash" },
    ]);
    expect(models[0]).toBe("gemini-2.5-flash");
  });

  it("新しい pro より、古くても flash を選ぶ(無料枠が pro は極端に少ないため)", () => {
    const models = rankModels([
      { name: "models/gemini-4.0-pro" },
      { name: "models/gemini-2.5-flash" },
    ]);
    expect(models[0]).toBe("gemini-2.5-flash");
  });

  it("flash が無ければ flash-lite、それも無ければ pro を使う", () => {
    expect(
      rankModels([{ name: "models/gemini-4.0-pro" }, { name: "models/gemini-2.5-flash-lite" }])[0]
    ).toBe("gemini-2.5-flash-lite");
    expect(rankModels([{ name: "models/gemini-4.0-pro" }])[0]).toBe("gemini-4.0-pro");
  });

  it("新しい世代を優先する", () => {
    const models = rankModels([
      { name: "models/gemini-2.0-flash" },
      { name: "models/gemini-4.1-flash" },
      { name: "models/gemini-2.5-flash" },
    ]);
    expect(models[0]).toBe("gemini-4.1-flash");
  });

  it("試験版(preview / exp)は安定版より後ろに回す", () => {
    const models = rankModels([
      { name: "models/gemini-2.5-flash-preview-09-2026" },
      { name: "models/gemini-2.5-flash" },
    ]);
    expect(models[0]).toBe("gemini-2.5-flash");
  });

  it("版数の無い別名(-latest)は、より新しい版があればそちらに譲る", () => {
    const models = rankModels([
      { name: "models/gemini-flash-latest" },
      { name: "models/gemini-4.0-flash" },
      { name: "models/gemini-2.0-flash" },
    ]);
    expect(models[0]).toBe("gemini-4.0-flash");
    // 古い版よりは別名を優先する(別名は常に最新へ向け直されるため)
    expect(models[1]).toBe("gemini-flash-latest");
  });

  it("generateContent に対応していないモデルは選ばない", () => {
    const models = rankModels([
      { name: "models/gemini-2.5-flash-live", supportedActions: ["bidiGenerateContent"] },
      { name: "models/gemini-2.5-flash", supportedActions: ["generateContent"] },
    ]);
    expect(models).toEqual(["gemini-2.5-flash"]);
  });

  it("フォールバック用に上位 3 つまで返す", () => {
    const models = rankModels([
      { name: "models/gemini-3.0-flash" },
      { name: "models/gemini-2.5-flash" },
      { name: "models/gemini-2.0-flash" },
      { name: "models/gemini-1.5-flash" },
    ]);
    expect(models).toHaveLength(3);
    expect(models).toEqual([
      "gemini-3.0-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ]);
  });

  it("候補が無ければ空を返す(呼び出し側がフォールバックに切り替える)", () => {
    expect(rankModels([{ name: "models/text-embedding-004" }])).toEqual([]);
  });
});
