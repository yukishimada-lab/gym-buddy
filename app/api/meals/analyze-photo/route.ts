import { NextResponse } from "next/server";
import { ThinkingLevel, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  GEMINI_NOT_CONFIGURED_MESSAGE,
  IMAGE_TIMEOUT_MS,
  describeGeminiError,
  extractText,
  failureBody,
  generateContent,
  getGeminiClient,
  parseJsonFromText,
  readImageRequest,
  toNonNegativeNumber,
} from "@/lib/gemini";
import type { EstimatedFoodItem } from "@/lib/types";

// 画像解析は数秒〜十数秒かかることがあるため上限を延長
export const maxDuration = 60;

const LABEL = "analyze-photo";

/**
 * POST /api/meals/analyze-photo
 * body: { image: string (base64), mimeType: string }
 * 食事写真から品目とおおよそのグラム数・PFC・カロリーを推定して返す。
 * Gemini API はこのサーバー内でのみ呼び出す(キーはクライアントに露出しない)。
 *
 * 失敗したときは必ず「なぜ失敗したか」が分かる日本語メッセージを返し、
 * サーバー側にも [gemini] 付きのログを残す(Vercel のログから追える)。
 */
export async function POST(request: Request) {
  // ログインユーザーのみ利用可(API キーの悪用防止)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const ai = getGeminiClient();
  if (!ai) {
    console.error(`[gemini] ${LABEL} aborted: GEMINI_API_KEY is not set`);
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE, code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const { image, mimeType } = await readImageRequest(request);
    console.log(
      `[gemini] ${LABEL} start mimeType=${mimeType} base64Length=${image.length}`
    );

    const { response } = await generateContent(ai, {
      label: LABEL,
      timeoutMs: IMAGE_TIMEOUT_MS,
      thinkingLevel: ThinkingLevel.LOW,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: image } },
            {
              text: [
                "あなたは日本の管理栄養士です。この食事の写真に写っている料理・食品をすべて特定してください。",
                "",
                "【出力するもの(1 品目ごと)】",
                "- food_name: 日本語の料理名・食品名(例: 白米、鶏むね肉のソテー、味噌汁)。英語やローマ字は使わないこと。",
                "- amount_g: その品目のおおよその重量(g)",
                "- protein_g / fat_g / carbs_g / calories: amount_g 全体ぶんの栄養素(100g あたりではない)",
                "",
                "【推定の指針】",
                "- 器やカトラリー、箸、手のサイズを基準にして量を見積もること。",
                "- 日本の一般的な 1 人前を目安にする(白米茶碗 1 杯 150g、味噌汁 1 杯 200g、卵 1 個 50g、食パン 6 枚切り 1 枚 60g など)。",
                "- ソースやドレッシング、揚げ油も見えていれば脂質に含めること。",
                "- 定食のように複数の料理が写っている場合は、まとめず 1 品ずつ分けること。",
                "- 数値は日本食品標準成分表を念頭に置いた現実的な概算にすること。分からない場合でも 0 にせず、常識的な概算を入れること。",
                "- 食べ物が写っていない場合だけ、空の配列を返すこと。",
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              food_name: { type: Type.STRING },
              amount_g: { type: Type.NUMBER },
              protein_g: { type: Type.NUMBER },
              fat_g: { type: Type.NUMBER },
              carbs_g: { type: Type.NUMBER },
              calories: { type: Type.NUMBER },
            },
            required: [
              "food_name",
              "amount_g",
              "protein_g",
              "fat_g",
              "carbs_g",
              "calories",
            ],
          },
        },
      },
    });

    const text = extractText(response, LABEL);
    const parsed = parseJsonFromText(text);
    if (!Array.isArray(parsed)) {
      console.error(
        `[gemini] ${LABEL} unexpected response shape: ${text.slice(0, 300)}`
      );
      return NextResponse.json(
        {
          error:
            "AI の回答を読み取れませんでした。もう一度お試しいただくか、手動で入力してください。(PARSE_FAILED)",
          code: "PARSE_FAILED",
        },
        { status: 502 }
      );
    }

    const items: EstimatedFoodItem[] = parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item) => ({
        food_name: String(item.food_name ?? "").slice(0, 100),
        amount_g: toNonNegativeNumber(item.amount_g, 100),
        protein_g: toNonNegativeNumber(item.protein_g),
        fat_g: toNonNegativeNumber(item.fat_g),
        carbs_g: toNonNegativeNumber(item.carbs_g),
        calories: toNonNegativeNumber(item.calories),
      }))
      .filter((item) => item.food_name.length > 0);

    console.log(`[gemini] ${LABEL} done items=${items.length}`);
    return NextResponse.json({ items });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} responding ${failure.status} ${failure.code}`);
    return NextResponse.json(failureBody(failure), { status: failure.status });
  }
}
