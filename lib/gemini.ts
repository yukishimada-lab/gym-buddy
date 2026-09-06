import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig, GenerateContentResponse } from "@google/genai";

/**
 * Gemini API のサーバー専用ヘルパー。
 * API キー(GEMINI_API_KEY)はサーバー環境変数からのみ読み込み、
 * クライアントには絶対に露出させない(NEXT_PUBLIC_ を付けないこと)。
 *
 * 【モデル名について】
 * Gemini のモデルには提供終了(shutdown)日があり、期限を過ぎたモデル名を
 * 指定すると API は 404「no longer available」を返す。
 * かつてはコードにモデル名を直書きしていたが、候補として並べた 3 つが
 * 同時に提供終了して AI 機能が全滅した(2026 年 9 月)。
 * そのため今は models.list() で「このキーで今使えるモデル」を取得し、
 * その中から選ぶようにしている(resolveModels)。
 * モデルが入れ替わってもコードの修正なしで追従できる。
 */

/**
 * 環境変数で使うモデルを固定したいときの指定(任意)。
 * 設定されていればこれだけを使い、自動検出は行わない。
 */
const PINNED_MODEL = process.env.GEMINI_MODEL?.trim() || null;

/**
 * モデル一覧を取得できなかったときに試す候補。
 * 実在しないモデルは 404 で次に進むだけなので、多めに並べておく。
 * "-latest" はモデルが入れ替わっても Google 側で新しい版に向け直される別名。
 */
const FALLBACK_MODELS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

/** 実際に試したモデル名(エラーメッセージに出すため覚えておく) */
let lastTriedModels: string[] = PINNED_MODEL ? [PINNED_MODEL] : FALLBACK_MODELS;

/** 自動検出の結果のキャッシュ(毎リクエスト models.list() を叩かないため) */
let modelCache: { models: string[]; expiresAt: number } | null = null;

/** キャッシュの有効期間。長すぎると提供終了に気付くのが遅れる */
const MODEL_CACHE_MS = 30 * 60 * 1000;

/** 文章生成に使えない(画像生成・埋め込み・音声など)モデルを弾く */
const NOT_A_CHAT_MODEL =
  /embedding|aqa|imagen|veo|tts|audio|image|learnlm|gemma|robotics|computer-use|guard/i;

/**
 * モデル名に点数を付ける。大きいほど優先。使えないものは null。
 *
 * 【並べる順番の考え方】
 * このアプリは Gemini の無料枠で動かしている。無料枠の上限はモデルごとに
 * 決まっていて、pro 系は flash 系よりはるかに少ない(まったく無いこともある)。
 * そのため「新しさ」より先に「flash かどうか」で並べる。
 * 新しい pro を選んでしまうと、数回使っただけで RATE_LIMITED になる。
 *
 *   1. flash(速い・安い・無料枠が多い)
 *   2. flash-lite(さらに軽い)
 *   3. pro(精度は高いが無料枠が少なく遅い。最後の手段)
 *
 * 同じ種類の中では新しい世代を優先し、試験版(preview / exp)は後回しにする。
 */
function scoreModel(name: string): number | null {
  if (!name.startsWith("gemini-")) return null;
  if (NOT_A_CHAT_MODEL.test(name)) return null;

  // 種類の差は世代の差より大きく効かせる(新しい pro より古い flash を選ぶ)
  let score: number;
  if (/flash-lite/.test(name)) score = 20_000;
  else if (/flash/.test(name)) score = 30_000;
  else if (/pro/.test(name)) score = 10_000;
  else score = 0;

  // gemini-2.5-flash → 2.5 / gemini-flash-latest → 版数なし
  const version = Number(/^gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? NaN);
  // 版数の無い別名(-latest)は「そこそこ新しい」扱いにする。
  // 常に最新へ向け直されるので提供終了には強いが、
  // 明示的に新しい版が並んでいればそちらを選ぶ。
  score += Number.isFinite(version) ? version * 100 : 300;

  // 試験版は不安定(仕様変更・打ち切りが多い)ので、同じ種類の中では後ろに回す
  if (/preview|-exp|experimental|-rc/.test(name)) score -= 5_000;

  return score;
}

/** models.list() が返す情報のうち、選定に使う部分 */
export type ModelCandidate = { name: string; supportedActions?: string[] };

/**
 * モデル候補を「使いたい順」に並べ替えて上位を返す。
 * ネットワークに触れない純粋関数なのでテストできる(lib/__tests__/gemini.test.ts)。
 */
export function rankModels(candidates: ModelCandidate[], limit = 3): string[] {
  const scored: { name: string; score: number }[] = [];
  for (const candidate of candidates) {
    const name = (candidate.name ?? "").replace(/^models\//, "");
    if (!name) continue;
    // generateContent に対応していないモデルは除く
    // (supportedActions が空のこともあるので、その場合は名前で判断する)
    const actions = candidate.supportedActions;
    if (actions?.length && !actions.includes("generateContent")) continue;
    const score = scoreModel(name);
    if (score != null) scored.push({ name, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((m) => m.name);
}

/**
 * このキーで実際に使えるモデルを Google に問い合わせて、良さそうな順に返す。
 *
 * モデル名をコードに直書きすると、提供終了(404)のたびに全機能が止まる。
 * 実際に 2026 年 9 月、直書きしていた 3 つのモデルが同時に使えなくなり
 * 外食検索などが全滅した。一覧から選べば、モデルが入れ替わっても追従できる。
 */
export async function resolveModels(ai: GoogleGenAI): Promise<string[]> {
  if (PINNED_MODEL) return [PINNED_MODEL];

  if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;

  try {
    const candidates: ModelCandidate[] = [];
    const pager = await ai.models.list();
    for await (const model of pager) {
      candidates.push({
        name: model.name ?? "",
        supportedActions: model.supportedActions,
      });
      if (candidates.length >= 300) break;
    }

    const models = rankModels(candidates);
    if (models.length === 0) {
      throw new Error("使えるモデルが 1 つも見つかりませんでした");
    }

    console.log(`[gemini] 使用するモデルを自動検出しました: ${models.join(" / ")}`);
    modelCache = { models, expiresAt: Date.now() + MODEL_CACHE_MS };
    lastTriedModels = models;
    return models;
  } catch (e) {
    console.error(`[gemini] モデル一覧の取得に失敗しました: ${messageOf(e)}`);
    lastTriedModels = FALLBACK_MODELS;
    return FALLBACK_MODELS;
  }
}

/** 自動検出のやり直しを促す(全モデルが提供終了だったときなど) */
export function invalidateModelCache(): void {
  modelCache = null;
}

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

/**
 * 画像つきリクエストの待ち時間の上限(ミリ秒)。Vercel の maxDuration より短くする。
 * これは「モデルを 1 つ試すごと」ではなく generateContent の呼び出し全体の上限。
 * モデルごとに数え直すと、フォールバックで 2 つ目・3 つ目を試している間に
 * Vercel の実行時間(maxDuration)を超え、関数が強制終了されて
 * JSON ですらないタイムアウト応答が返ってしまう。
 */
export const IMAGE_TIMEOUT_MS = 45_000;
/** テキストのみのリクエストの待ち時間の上限(ミリ秒)。同じく呼び出し全体の上限。 */
export const TEXT_TIMEOUT_MS = 40_000;

/** 残り時間がこれを下回ったら、次のモデルを試さず打ち切る(中途半端な再試行を避ける) */
const MIN_ATTEMPT_MS = 5_000;

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

/**
 * リクエストの中身がモデルに受け付けられなかった(400 INVALID_ARGUMENT)エラーか。
 * 新しい設定項目(thinkingConfig など)に対応していないモデルに当たったときに出る。
 * モデルを変えれば通ることがあるので、これもフォールバックの対象にする。
 */
function isInvalidArgument(e: unknown): boolean {
  const status = statusOf(e);
  if (status === 400) return true;
  return messageOf(e).toLowerCase().includes("invalid_argument");
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
        `AI モデル(${lastTriedModels.join(" / ")})が利用できませんでした。` +
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
  if (isInvalidArgument(e)) {
    return {
      status: 502,
      message:
        "AI がリクエストを受け付けませんでした(モデルの設定が合っていない可能性があります)。" +
        "少し時間をおいてお試しください。直らない場合、管理者は /api/gemini/health で使えるモデルを確認してください。",
      code: "INVALID_ARGUMENT",
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
 *
 * 待ち時間(timeoutMs)は「呼び出し全体」の予算として扱い、モデルを試すたびに
 * 残り時間を配り直す。こうしないとフォールバック中に Vercel の実行時間を超え、
 * 「なぜ失敗したのか分からない 504」になってしまう。
 */
export async function generateContent(
  ai: GoogleGenAI,
  options: GenerateOptions
): Promise<{ response: GenerateContentResponse; model: string }> {
  const timeoutMs = options.timeoutMs ?? TEXT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  const models = await resolveModels(ai);

  // 試す順番。thinkingLevel に対応していないモデルに当たると 400 で弾かれるため、
  // そのモデルは thinkingConfig 抜きでもう一度だけ試せるようにしておく。
  const attempts: { model: string; withThinking: boolean }[] = [];
  for (const model of models) {
    if (options.thinkingLevel && supportsThinkingLevel(model)) {
      attempts.push({ model, withThinking: true });
    }
    attempts.push({ model, withThinking: false });
  }

  /** 見切りをつけたモデル(残りの試行を飛ばす) */
  let skipModel: string | null = null;
  /** 1 回でも実際に呼び出したか(残り時間の判定は 2 回目以降にだけ効かせる) */
  let attempted = false;

  for (const { model, withThinking } of attempts) {
    if (model === skipModel) continue;
    const remaining = deadline - Date.now();
    if (attempted && remaining <= MIN_ATTEMPT_MS) {
      console.error(
        `[gemini] ${options.label} skipped model=${model} (残り時間が足りないため打ち切り)`
      );
      break;
    }
    const startedAt = Date.now();
    attempted = true;
    try {
      const config: GenerateContentConfig = {
        ...options.config,
        abortSignal: AbortSignal.timeout(Math.max(remaining, 1_000)),
      };
      if (withThinking) {
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
        `[gemini] ${options.label} ok model=${model} thinking=${withThinking} ${Date.now() - startedAt}ms`
      );
      return { response, model };
    } catch (e) {
      lastError = e;
      const failure = describeGeminiError(e);
      console.error(
        `[gemini] ${options.label} failed model=${model} thinking=${withThinking} ${Date.now() - startedAt}ms code=${failure.code}: ${messageOf(e)}`
      );
      // thinkingConfig が原因で弾かれた可能性があるので、まず外して同じモデルを試す
      if (withThinking && isInvalidArgument(e)) continue;
      // 提供終了(404)のときは次の候補を試す。
      // 無料枠のレート制限はモデルごとにかかるため、429 も次の候補を試す。
      // リクエスト自体を受け付けてもらえない(400)ときも、別のモデルなら通ることがある。
      // それ以外(キー不正など)はモデルを変えても直らないので即座に返す。
      const retryable =
        isModelUnavailable(e) ||
        isInvalidArgument(e) ||
        failure.code === "RATE_LIMITED";
      if (!retryable) throw new GeminiError(failure);
      skipModel = model;
    }
  }

  // 候補が全滅した = 自動検出した一覧が古い可能性があるので、次回は取り直す
  if (isModelUnavailable(lastError)) invalidateModelCache();

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
