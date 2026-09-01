import { NextResponse } from "next/server";
import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  GEMINI_MODEL,
  GEMINI_NOT_CONFIGURED_MESSAGE,
  getGeminiClient,
  parseJsonFromText,
  toNonNegativeNumber,
} from "@/lib/gemini";
import type { EstimatedFoodItem } from "@/lib/types";

// 画像解析は数秒〜十数秒かかることがあるため上限を延長
export const maxDuration = 60;

/**
 * POST /api/meals/analyze-photo
 * body: { image: string (base64), mimeType: string }
 * 食事写真から品目とおおよそのグラム数・PFC・カロリーを推定して返す。
 * Gemini API はこのサーバー内でのみ呼び出す(キーはクライアントに露出しない)。
 */
export async function POST(request: Request) {
  // ログインユーザーのみ利用可(API キーの悪用防止)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "ログインが必要です。" },
      { status: 401 }
    );
  }

  const ai = getGeminiClient();
  if (!ai) {
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE },
      { status: 503 }
    );
  }

  let image: string;
  let mimeType: string;
  try {
    const body = await request.json();
    image = body.image;
    mimeType = body.mimeType || "image/jpeg";
    if (typeof image !== "string" || image.length === 0) {
      throw new Error("image is required");
    }
  } catch {
    return NextResponse.json(
      { error: "画像データが不正です。もう一度お試しください。" },
      { status: 400 }
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: image } },
            {
              text: [
                "この食事の写真に写っている料理・食品をすべて特定してください。",
                "それぞれについて、日本語の食品名、おおよその重量(g)、",
                "その重量あたりの栄養素(タンパク質g・脂質g・炭水化物g・カロリーkcal)を推定してください。",
                "重量と栄養素は日本の一般的な盛り付けを基準にした現実的な概算値にしてください。",
                "食べ物が写っていない場合は空の配列を返してください。",
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

    const parsed = parseJsonFromText(response.text ?? "");
    const items: EstimatedFoodItem[] = Array.isArray(parsed)
      ? parsed
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
          .filter((item) => item.food_name.length > 0)
      : [];

    return NextResponse.json({ items });
  } catch (e) {
    console.error("analyze-photo failed:", e);
    return NextResponse.json(
      {
        error:
          "写真の解析に失敗しました。時間をおいて再度お試しいただくか、手動で入力してください。",
      },
      { status: 500 }
    );
  }
}
