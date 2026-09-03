import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig, GenerateContentResponse } from "@google/genai";

/**
 * Gemini API のサーバー専用ヘルパー。
 * API キー(GEMINI_API_KEY)はサーバー環境変数からのみ読み込み、
 * クライアントには絶対に露出させない(NEXT_PUBLIC_ を付けないこと)。
 *
 * 【モデル名について】
 * Gemini のモデルには提供終了(shutdown)日があり、期限を過ぎたモデル名を
 * 指定すると API は 404「no longer available」を返す。以前使っていた
 * gemini-2.0-flash は 2026-06-01 に提供終了しており、これが原因で
 * 写真解析などの機能がすべて失敗していた。
 * 同じことが再発しても止まらないよう、下の配列を順に試すようにしている。
 */

/** 優先順に試すモデル。先頭から順に、404(提供終了)なら次を試す。 */
export const GEMINI_MODELS: string[] = (
  process.env.GEMINI_MODEL?.trim()
    ? [process.env.GEMINI_MODEL.trim()]
    : ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]
);

/** 表示・ログ用の代表モデル名 */
export const GEMINI_MODEL = GEMINI_MODELS[0];

export const GEMINI_NOT_CONFIGURED_MESSAGE =
  "Gemini API キーが設定されていません。環境変数 GEMINI_API_KEY を設定してください(取得方法は README を参照)。";

/** Gemini がインライン画像として受け付ける形式 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/**
 * 受け付ける画像データ(base64)の上限。
 * Vercel のサーバーレス関数はリクエストボディが 4.5MB までなので、
 * それより手前で分かりやすいエラーにする(base64 は元データの約 4/3 倍)。
 */
export const MAX_IMAGE_BASE64_LENGTH = 4_000_000;

/** 画像つきリクエストの待ち時間の上限(ミリ秒)。Vercel の maxDuration より短くする。 */
export const IMAGE_TIMEOUT_MS = 45_000;
/** テキストのみのリクエストの待ち時間の上限(ミリ秒) */
export const TEXT_TIMEOUT_MS = 40_000;

/** キー未設定なら null を返す(ビルド時・未設定環境でも壊れないように) */
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

/** ユーザーに返す失敗情報(日本語メッセージ + 追跡用コード) */
export type GeminiFailure = {
  /** クライアントに返す HTTP ステータス */
  status: number;
  /** 画面にそのまま出す日本語メッセージ */
  message: string;
  /** ログ・問い合わせ用の短いコード(画面にも括弧書きで出す) */
  code: string;
};

/** 原因が特定できる失敗。呼び出し側はこれを掴んでそのまま返せばよい。 */
export class GeminiError extends Error {
  readonly failure: GeminiFailure;
  constructor(failure: GeminiFailure) {
    super(`${failure.code}: ${failure.message}`);
    this.name = "GeminiError";
    this.failure = failure;
  }
}

/** unknown なエラーから HTTP ステータスらしき数値を取り出す */
function statusOf(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const rec = e as Record<string, unknown>;
  if (typeof rec.status === "number") return rec.status;
  if (typeof rec.code === "number") return rec.code;
  return null;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** そのモデルが存在しない/提供終了、を表すエラーか */
function isModelUnavailable(e: unknown): boolean {
  const status = statusOf(e);
  const msg = messageOf(e).toLowerCase();
  if (status === 404) return true;
  return (
    msg.includes("no longer available") ||
    msg.includes("is not found for api version") ||
    (msg.includes("not_found") && msg.includes("model"))
  );
}

function isAbort(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const name = (e as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Gemini からのエラーを、ユーザーが原因を判別できる日本語メッセージに変換する。
 * 「うまくいかない」で終わらせないための中核。
 */
export function describeGeminiError(e: unknown): GeminiFailure {
  if (e instanceof GeminiError) return e.failure;

  if (isAbort(e)) {
    return {
      status: 504,
      message:
        "AI の応答に時間がかかりすぎたため中断しました。電波の良い場所で、もう一度お試しください。",
      code: "TIMEOUT",
    };
  }

  const status = statusOf(e);
  const raw = messageOf(e);
  const msg = raw.toLowerCase();

  if (isModelUnavailable(e)) {
    return {
      status: 502,
      message:
        `AI モデル(${GEMINI_MODELS.join(" / ")})が利用できませんでした。` +
        "モデルの提供が終了している可能性があります。管理者は /api/gemini/health で利用できるモデルを確認してください。",
      code: "MODEL_UNAVAILABLE",
    };
  }
  if (msg.includes("api key not valid") || msg.includes("api_key_invalid")) {
    return {
      status: 502,
      message:
        "Gemini API キーが正しくありません。Vercel の環境変数 GEMINI_API_KEY を設定し直してください。",
      code: "API_KEY_INVALID",
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      message:
        "Gemini API キーが拒否されました(権限エラー)。Google AI Studio でキーを再発行して設定し直してください。",
      code: `AUTH_${status}`,
    };
  }
  if (status === 429 || msg.includes("resource_exhausted") || msg.includes("quota")) {
    return {
      status: 429,
      message:
        "Gemini API の利用上限(無料枠のレート制限)に達しました。1〜2 分ほど待ってから、もう一度お試しください。",
      code: "RATE_LIMITED",
    };
  }
  if (status === 413 || msg.includes("request entity too large")) {
    return {
      status: 413,
      message:
        "画像のデータが大きすぎます。もう一度撮り直すか、別の写真でお試しください。",
      code: "PAYLOAD_TOO_LARGE",
    };
  }
  if (
    msg.includes("unsupported mime") ||
    msg.includes("invalid image") ||
    msg.includes("could not process image") ||
    msg.includes("unable to process input image")
  ) {
    return {
      status: 415,
      message:
        "画像の形式に対応していないため読み取れませんでした。別の写真でお試しください。",
      code: "UNSUPPORTED_IMAGE",
    };
  }
  if (status === 503 || msg.includes("overloaded") || msg.includes("unavailable")) {
    return {
      status: 503,
      message:
        "AI サービスが混み合っています。少し時間をおいて、もう一度お試しください。",
      code: "SERVICE_UNAVAILABLE",
    };
  }
  if (status === 500 || msg.includes("internal")) {
    return {
      status: 502,
      message:
        "AI サービス側でエラーが発生しました。少し時間をおいて、もう一度お試しください。",
      code: "UPSTREAM_ERROR",
    };
  }
  return {
    status: 502,
    message:
      "AI の呼び出しに失敗しました。時間をおいて再度お試しいただくか、手動で入力してください。",
    code: status ? `HTTP_${status}` : "UNKNOWN",
  };
}

/** thinkingLevel は Gemini 3 系のみ対応。2.x に渡すとエラーになるので分岐する。 */
function supportsThinkingLevel(model: string): boolean {
  return /^gemini-3/.test(model);
}

type GenerateOptions = {
  /** ログに出す機能名(例: "analyze-photo") */
  label: string;
  contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];
  config?: GenerateContentConfig;
  timeoutMs?: number;
  /** 簡単な抽出タスクは思考を浅くしてレスポンスを速くする */
  thinkingLevel?: ThinkingLevel;
};

/**
 * モデルのフォールバック・タイムアウト・失敗ログをまとめて面倒みる generateContent。
 * モデルが提供終了(404)なら次の候補を試すので、モデル入れ替えで全機能が
 * 止まる事故が起きない。
 */
export async function generateContent(
  ai: GoogleGenAI,
  options: GenerateOptions
): Promise<{ response: GenerateContentResponse; model: string }> {
  const timeoutMs = options.timeoutMs ?? TEXT_TIMEOUT_MS;
  let lastError: unknown = null;

  for (const model of GEMINI_MODELS) {
    const startedAt = Date.now();
    try {
      const config: GenerateContentConfig = {
        ...options.config,
        abortSignal: AbortSignal.timeout(timeoutMs),
      };
      if (options.thinkingLevel && supportsThinkingLevel(model)) {
        config.thinkingConfig = {
          ...config.thinkingConfig,
          thinkingLevel: options.thinkingLevel,
        };
      }
      const response = await ai.models.generateContent({
        model,
        contents: options.contents,
        config,
      });
      console.log(
        `[gemini] ${options.label} ok model=${model} ${Date.now() - startedAt}ms`
      );
      return { response, model };
    } catch (e) {
      lastError = e;
      const failure = describeGeminiError(e);
      console.error(
        `[gemini] ${options.label} failed model=${model} ${Date.now() - startedAt}ms code=${failure.code}: ${messageOf(e)}`
      );
      // 提供終了(404)のときは次の候補を試す。
      // 無料枠のレート制限はモデルごとにかかるため、429 も次の候補を試す。
      // それ以外(キー不正など)はモデルを変えても直らないので即座に返す。
      const retryable =
        isModelUnavailable(e) || failure.code === "RATE_LIMITED";
      if (!retryable) throw new GeminiError(failure);
    }
  }

  throw new GeminiError(describeGeminiError(lastError));
}

/**
 * 応答からテキストを取り出す。空になる理由(安全性ブロック・トークン切れ)を
 * 区別して、原因の分かるエラーにする。
 */
export function extractText(
  response: GenerateContentResponse,
  label: string
): string {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    console.error(`[gemini] ${label} blocked reason=${blockReason}`);
    throw new GeminiError({
      status: 422,
      message:
        "安全性フィルタにより、この画像・内容は解析できませんでした。別の写真でお試しください。",
      code: "BLOCKED",
    });
  }

  const text = (response.text ?? "").trim();
  if (text) return text;

  const finishReason = response.candidates?.[0]?.finishReason;
  console.error(`[gemini] ${label} empty response finishReason=${finishReason}`);
  if (finishReason === "MAX_TOKENS") {
    throw new GeminiError({
      status: 502,
      message:
        "AI の回答が長くなりすぎて途中で切れました。写っている範囲を絞って撮り直してみてください。",
      code: "MAX_TOKENS",
    });
  }
  if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
    throw new GeminiError({
      status: 422,
      message:
        "安全性フィルタにより、この画像・内容は解析できませんでした。別の写真でお試しください。",
      code: "BLOCKED",
    });
  }
  throw new GeminiError({
    status: 502,
    message:
      "AI から結果が返ってきませんでした。もう一度お試しいただくか、手動で入力してください。",
    code: "EMPTY_RESPONSE",
  });
}

/** リクエストボディから画像を取り出して検証する。問題があれば GeminiError を投げる。 */
export async function readImageRequest(
  request: Request
): Promise<{ image: string; mimeType: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new GeminiError({
      status: 400,
      message: "画像データを受け取れませんでした。もう一度お試しください。",
      code: "BAD_BODY",
    });
  }

  const rec = (body ?? {}) as Record<string, unknown>;
  const image = typeof rec.image === "string" ? rec.image : "";
  const mimeType =
    typeof rec.mimeType === "string" && rec.mimeType ? rec.mimeType : "image/jpeg";

  if (!image) {
    throw new GeminiError({
      status: 400,
      message: "画像データが空でした。写真を選び直してお試しください。",
      code: "EMPTY_IMAGE",
    });
  }
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new GeminiError({
      status: 415,
      message: `この画像形式(${mimeType})には対応していません。カメラで撮り直すか、別の写真でお試しください。`,
      code: "UNSUPPORTED_MIME",
    });
  }
  if (image.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new GeminiError({
      status: 413,
      message:
        "画像のデータが大きすぎます。ページを再読み込みしてから、もう一度お試しください。",
      code: "IMAGE_TOO_LARGE",
    });
  }
  return { image, mimeType };
}

/** GeminiFailure をそのまま JSON レスポンスにするための本体 */
export function failureBody(failure: GeminiFailure) {
  return { error: `${failure.message}(${failure.code})`, code: failure.code };
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
