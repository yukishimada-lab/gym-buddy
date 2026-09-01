import { GoogleGenAI } from "@google/genai";

/**
 * Gemini API のサーバー専用ヘルパー。
 * API キー(GEMINI_API_KEY)はサーバー環境変数からのみ読み込み、
 * クライアントには絶対に露出させない(NEXT_PUBLIC_ を付けないこと)。
 */

export const GEMINI_MODEL = "gemini-2.0-flash";

export const GEMINI_NOT_CONFIGURED_MESSAGE =
  "Gemini API キーが設定されていません。環境変数 GEMINI_API_KEY を設定してください(取得方法は README を参照)。";

/** キー未設定なら null を返す(ビルド時・未設定環境でも壊れないように) */
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

/** Gemini の応答テキストから JSON 部分を取り出してパースする */
export function parseJsonFromText(text: string): unknown {
  // ```json ... ``` のコードフェンスを除去
  const stripped = text
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // 前後に説明文が付いている場合は最初の { } / [ ] を抜き出す
    const match = stripped.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 数値らしき値を非負の number に正規化する(不正値は fallback) */
export function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 10) / 10;
}
