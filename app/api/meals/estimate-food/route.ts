import { NextResponse } from "next/server";
import { ThinkingLevel, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import {
  GEMINI_NOT_CONFIGURED_MESSAGE,
  TEXT_TIMEOUT_MS,
  describeGeminiError,
  extractText,
  failureBody,
  generateContent,
  getGeminiClient,
  parseJsonFromText,
  toNonNegativeNumber,
} from "@/lib/gemini";
import { foodCacheKey } from "@/lib/nutritionCache";
import {
  readNutritionCache,
  touchNutritionCache,
  writeNutritionCache,
} from "@/lib/nutritionCacheStore";

export const maxDuration = 60;

const LABEL = "estimate-food";

/** 入力の上限(長すぎる文字列を AI に投げない) */
const MAX_NAME_LENGTH = 60;

/**
 * POST /api/meals/estimate-food
 * body: { name: string }
 *
 * 食品マスタに無い食品名から、栄養価を推定して返す。
 *
 *   「豚バラ」    → 食材。可食部 100g あたりの標準的な値
 *   「ピザトースト」→ 料理。100g あたりの値 + 1 人前のおおよその重さ
 *
 * 返す数値は必ず「100g あたり」にそろえる。食事記録の計算(グラム数 × 100g
 * あたり)がそのまま使えるようにするため。1 人前の重さは serving_g で別に返し、
 * 画面ではそれを初期値のグラム数に使う。
 *
 * 一度調べた食品は nutrition_cache に保存し、2 回目以降は AI を呼ばずに返す。
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  let name: string;
  try {
    const body = await request.json();
    name = String(body.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (!name) throw new Error("name required");
  } catch {
    return NextResponse.json(
      { error: "食品名を入力してください。" },
      { status: 400 }
    );
  }

  const cacheKey = foodCacheKey(name);

  // 1. まずキャッシュ(過去に誰かが調べたもの)
  const cached = await readNutritionCache(supabase, "food", cacheKey);
  if (cached) {
    void touchNutritionCache(supabase, cached.id);
    console.log(`[cache] ${LABEL} hit key=${cacheKey}`);
    return NextResponse.json({
      found: true,
      cached: true,
      item: {
        food_name: cached.display_name,
        protein_g: cached.protein_g,
        fat_g: cached.fat_g,
        carbs_g: cached.carbs_g,
        calories: cached.calories,
      },
      serving_g: cached.serving_g,
      note: cached.note,
    });
  }

  // 2. 無ければ AI に聞く
  const ai = getGeminiClient();
  if (!ai) {
    console.error(`[gemini] ${LABEL} aborted: GEMINI_API_KEY is not set`);
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE, code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const { response } = await generateContent(ai, {
      label: LABEL,
      timeoutMs: TEXT_TIMEOUT_MS,
      thinkingLevel: ThinkingLevel.LOW,
      contents: [
        "あなたは日本の管理栄養士です。",
        `「${name}」という食品の栄養価を答えてください。`,
        "",
        "【数値の決まり】",
        "- protein_g / fat_g / carbs_g / calories は、必ず「可食部 100g あたり」の値にすること。",
        "- 日本食品標準成分表に載っている食材は、その値を使うこと。",
        "- 料理・加工食品(例: ピザトースト、カレーライス、牛丼)は、",
        "  一般的なレシピ・市販品の平均的な値にすること。",
        "- 調理法が書かれていない食材は、生の状態の値にすること",
        "  (「豚バラ」なら豚ばら肉・生)。",
        "",
        "【1 人前の重さ(serving_g)】",
        "- 料理・加工食品なら、1 人前のおおよその重さ(g)を入れること。",
        "- 食材で 1 人前が決まっていない場合は null にすること。",
        "",
        "【category】",
        '- ingredient: 素材そのもの(豚バラ、白米、卵)',
        '- dish: 調理した料理(ピザトースト、カレーライス)',
        '- processed: 加工食品・市販品(食パン、ヨーグルト)',
        "",
        "【found】",
        "- 食品として判断できない語(人名・地名・意味の分からない文字列)は found を false にし、",
        "  数値はすべて 0 にすること。",
        "",
        "【note】",
        "- 何の値なのかが分かる短い日本語を入れること",
        "  (例: 「豚ばら肉・生 100g あたり(日本食品標準成分表)」)。",
      ].join("\n"),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            found: { type: Type.BOOLEAN },
            food_name: { type: Type.STRING },
            category: { type: Type.STRING },
            protein_g: { type: Type.NUMBER },
            fat_g: { type: Type.NUMBER },
            carbs_g: { type: Type.NUMBER },
            calories: { type: Type.NUMBER },
            serving_g: { type: Type.NUMBER, nullable: true },
            note: { type: Type.STRING },
          },
          required: [
            "found",
            "food_name",
            "category",
            "protein_g",
            "fat_g",
            "carbs_g",
            "calories",
            "note",
          ],
        },
      },
    });

    const text = extractText(response, LABEL);
    const parsed = parseJsonFromText(text) as Record<string, unknown> | null;

    if (!parsed || parsed.found !== true) {
      console.error(
        `[gemini] ${LABEL} not found name=${name}: ${text.slice(0, 200)}`
      );
      return NextResponse.json({
        found: false,
        note:
          typeof parsed?.note === "string"
            ? parsed.note
            : "この名前では栄養価を推定できませんでした。別の言い方でお試しください。",
      });
    }

    const displayName =
      typeof parsed.food_name === "string" && parsed.food_name.trim()
        ? parsed.food_name.trim().slice(0, 100)
        : name;
    const servingG =
      typeof parsed.serving_g === "number" && parsed.serving_g > 0
        ? Math.round(parsed.serving_g)
        : null;
    const note =
      typeof parsed.note === "string" && parsed.note.trim()
        ? parsed.note.trim().slice(0, 300)
        : null;

    const item = {
      food_name: displayName,
      protein_g: toNonNegativeNumber(parsed.protein_g),
      fat_g: toNonNegativeNumber(parsed.fat_g),
      carbs_g: toNonNegativeNumber(parsed.carbs_g),
      calories: toNonNegativeNumber(parsed.calories),
    };

    // 3. 次からは AI を呼ばなくて済むよう保存する(失敗しても結果は返す)
    void writeNutritionCache(supabase, {
      kind: "food",
      cache_key: cacheKey,
      display_name: displayName,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carbs_g: item.carbs_g,
      calories: item.calories,
      serving_g: servingG,
      note,
      source: "ai",
      created_by: user.id,
    });

    return NextResponse.json({
      found: true,
      cached: false,
      item,
      serving_g: servingG,
      note,
    });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} responding ${failure.status} ${failure.code}`);
    return NextResponse.json(failureBody(failure), { status: failure.status });
  }
}
