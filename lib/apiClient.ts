/**
 * 自前 API を叩くときの共通処理(クライアント専用)。
 *
 * これまでは res.json() をいきなり呼んでいたため、Vercel のタイムアウトなどで
 * JSON ではないレスポンス(HTML のエラーページ)が返ると例外になり、
 * 画面には「処理に失敗しました」としか出なかった。
 * ここで状況ごとに日本語のメッセージへ振り分ける。
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/** 画像解析など、時間のかかる API のクライアント側タイムアウト(ミリ秒) */
export const ANALYZE_TIMEOUT_MS = 55_000;

function statusMessage(status: number): string {
  if (status === 401) return "ログインの有効期限が切れました。ログインし直してください。";
  if (status === 413)
    return "送信した画像が大きすぎました。もう一度撮り直してお試しください。";
  if (status === 429)
    return "AI の利用上限に達しました。1〜2 分ほど待ってから、もう一度お試しください。";
  if (status === 504)
    return "サーバーの処理が時間内に終わりませんでした(504)。電波の良い場所で、もう一度お試しください。";
  if (status >= 500)
    return `サーバーでエラーが発生しました(${status})。少し時間をおいてお試しください。`;
  return `リクエストが受け付けられませんでした(${status})。`;
}

/** JSON を POST して結果を受け取る。失敗時は必ず日本語の理由が入る。 */
export async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs = ANALYZE_TIMEOUT_MS
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        message:
          "時間がかかりすぎたため中断しました。電波の良い場所で、もう一度お試しください。",
      };
    }
    return {
      ok: false,
      message:
        "通信に失敗しました。電波の状況を確認して、もう一度お試しください。",
    };
  } finally {
    clearTimeout(timer);
  }

  // タイムアウト時などは HTML やプレーンテキストが返ってくることがある
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { ok: false, message: statusMessage(res.status) };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, message: statusMessage(res.status) };
  }

  if (!res.ok) {
    const message =
      typeof (json as { error?: unknown })?.error === "string"
        ? ((json as { error: string }).error)
        : statusMessage(res.status);
    return { ok: false, message };
  }
  return { ok: true, data: json as T };
}
