import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GEMINI_MODELS,
  GEMINI_NOT_CONFIGURED_MESSAGE,
  describeGeminiError,
  extractText,
  generateContent,
  getGeminiClient,
} from "@/lib/gemini";

export const maxDuration = 60;

const LABEL = "health";

/**
 * GET /api/gemini/health
 *
 * AI 機能が動かないときに、原因(キー未設定 / キー無効 / モデル提供終了 /
 * レート制限)を切り分けるための自己診断エンドポイント。
 * ログイン済みのユーザーがブラウザで開けば、そのまま結果が JSON で読める。
 *
 * 画像を送らずに軽いテキスト生成を 1 回だけ試すので、失敗しても
 * 無料枠をほとんど消費しない。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return NextResponse.json(
      {
        ok: false,
        summary: GEMINI_NOT_CONFIGURED_MESSAGE,
        code: "NOT_CONFIGURED",
        configuredModels: GEMINI_MODELS,
      },
      { status: 503 }
    );
  }

  // このキーで使えるモデルの一覧(モデル名が古くないかの確認用)
  let availableModels: string[] | null = null;
  let listError: string | null = null;
  try {
    const pager = await ai.models.list();
    const names: string[] = [];
    for await (const model of pager) {
      const name = (model.name ?? "").replace(/^models\//, "");
      if (name) names.push(name);
      if (names.length >= 200) break;
    }
    availableModels = names.sort();
  } catch (e) {
    listError = describeGeminiError(e).code;
    console.error(`[gemini] ${LABEL} models.list failed: ${listError}`);
  }

  // 実際に 1 回だけ生成してみる(ここが通れば本番の解析も通る)
  const startedAt = Date.now();
  try {
    const { response, model } = await generateContent(ai, {
      label: LABEL,
      timeoutMs: 20_000,
      contents: "「OK」とだけ返してください。",
    });
    const text = extractText(response, LABEL);
    return NextResponse.json({
      ok: true,
      summary: `AI は正常に応答しています(使用モデル: ${model})。`,
      usedModel: model,
      latencyMs: Date.now() - startedAt,
      reply: text.slice(0, 50),
      configuredModels: GEMINI_MODELS,
      availableModels,
      listError,
    });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} generate failed code=${failure.code}`);
    return NextResponse.json(
      {
        ok: false,
        summary: failure.message,
        code: failure.code,
        latencyMs: Date.now() - startedAt,
        configuredModels: GEMINI_MODELS,
        availableModels,
        listError,
      },
      { status: failure.status }
    );
  }
}
