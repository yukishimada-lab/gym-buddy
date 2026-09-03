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
import type { MyProductBasis, NutritionLabelReading } from "@/lib/types";

// 画像解析は数秒〜十数秒かかることがあるため上限を延長
export const maxDuration = 60;

const LABEL = "analyze-label";

const BASIS_VALUES: MyProductBasis[] = ["per_100g", "per_serving", "per_piece"];

function toBasis(value: unknown): MyProductBasis {
  return BASIS_VALUES.includes(value as MyProductBasis)
    ? (value as MyProductBasis)
    : "per_100g";
}

/** 空文字を null にしつつ長さを制限する */
function toText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "不明") return null;
  return trimmed.slice(0, max);
}

/** 正の数だけ通す(0 や不正値は null = 未入力扱い) */
function toPositiveOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

/**
 * POST /api/products/analyze-label
 * body: { image: string (base64), mimeType: string }
 *
 * 商品パッケージの「栄養成分表示」を撮った写真から、
 * 基準量(100g / 1食 / 1個)とカロリー・PFC を読み取って返す。
 * 返した値はそのまま保存せず、必ずユーザーが確認・修正できる形で表示すること。
 *
 * Gemini API はこのサーバー内でのみ呼び出す(キーはクライアントに露出しない)。
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
                "これは日本の食品パッケージの写真です。「栄養成分表示」の表を読み取ってください。",
                "",
                "【読み取るもの】",
                "- name: 商品名(写っていれば。無ければ空文字)",
                "- maker: メーカー名・ブランド名(写っていれば。無ければ空文字)",
                "- basis: 栄養成分表示の基準量。",
                "    「100gあたり」「100mlあたり」なら per_100g、",
                "    「1食(1袋・1本・1回分)あたり」なら per_serving、",
                "    「1個あたり」なら per_piece。",
                "- basis_text: 基準量として書かれている文言そのまま(例: 「1食(40g)当たり」)",
                "- serving_g: 1食 / 1個 が何グラムかが書かれていればその数値。書かれていなければ 0。",
                "- calories: エネルギー(kcal)",
                "- protein_g: たんぱく質(g)",
                "- fat_g: 脂質(g)",
                "- carbs_g: 炭水化物(g)",
                "- note: 読み取りの補足(例: 炭水化物は糖質+食物繊維から算出しました)。無ければ空文字。",
                "",
                "【注意】",
                "- 数値はすべて basis で示した基準量あたりの値にしてください。単位の換算はしないこと。",
                "- 炭水化物の代わりに「糖質」と「食物繊維」が分かれて書かれている場合は、その合計を carbs_g にし、note にその旨を書いてください。",
                "- 複数の基準量が併記されている場合(例: 100gあたりと1食あたり)は、100gあたりを優先してください。",
                "- 「-」「0」など読み取れない項目は 0 にしてください。数値をでっち上げないこと。",
                "- kJ(キロジュール)ではなく kcal の値を使ってください。",
                "- 栄養成分表示が写っていない場合は、すべて 0 / 空文字にし、note に「栄養成分表示が見つかりませんでした」と書いてください。",
              ].join("\n"),
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            maker: { type: Type.STRING },
            basis: {
              type: Type.STRING,
              enum: ["per_100g", "per_serving", "per_piece"],
            },
            basis_text: { type: Type.STRING },
            serving_g: { type: Type.NUMBER },
            calories: { type: Type.NUMBER },
            protein_g: { type: Type.NUMBER },
            fat_g: { type: Type.NUMBER },
            carbs_g: { type: Type.NUMBER },
            note: { type: Type.STRING },
          },
          required: [
            "name",
            "maker",
            "basis",
            "basis_text",
            "serving_g",
            "calories",
            "protein_g",
            "fat_g",
            "carbs_g",
            "note",
          ],
        },
      },
    });

    const text = extractText(response, LABEL);
    const parsed = parseJsonFromText(text) as Record<string, unknown> | null;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(
        `[gemini] ${LABEL} unexpected response shape: ${text.slice(0, 300)}`
      );
      return NextResponse.json(
        {
          error:
            "栄養成分表示を読み取れませんでした。表の部分が大きく写るように撮り直すか、手入力してください。(PARSE_FAILED)",
          code: "PARSE_FAILED",
        },
        { status: 502 }
      );
    }

    const reading: NutritionLabelReading = {
      name: toText(parsed.name, 100),
      maker: toText(parsed.maker, 60),
      basis: toBasis(parsed.basis),
      basis_text: toText(parsed.basis_text, 60),
      serving_g: toPositiveOrNull(parsed.serving_g),
      protein_g: toNonNegativeNumber(parsed.protein_g),
      fat_g: toNonNegativeNumber(parsed.fat_g),
      carbs_g: toNonNegativeNumber(parsed.carbs_g),
      calories: toNonNegativeNumber(parsed.calories),
      note: toText(parsed.note, 200),
    };

    // 数値がすべて 0 なら「読み取れなかった」とみなして呼び出し側で案内する
    const empty =
      reading.calories === 0 &&
      reading.protein_g === 0 &&
      reading.fat_g === 0 &&
      reading.carbs_g === 0;

    console.log(`[gemini] ${LABEL} done empty=${empty} basis=${reading.basis}`);
    return NextResponse.json({ reading, empty });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} responding ${failure.status} ${failure.code}`);
    return NextResponse.json(failureBody(failure), { status: failure.status });
  }
}
