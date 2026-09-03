import { NextResponse } from "next/server";
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

// Google 検索グラウンディングは時間がかかることがあるため上限を延長
export const maxDuration = 60;

const LABEL = "restaurant-search";

/**
 * POST /api/meals/restaurant-search
 * body: { restaurant: string, menu: string }
 * 店名+メニュー名から、公式に公開されている栄養成分情報を
 * Gemini の Google 検索グラウンディングで検索・抽出して返す。
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
    console.error(`[gemini] ${LABEL} aborted: GEMINI_API_KEY is not set`);
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE, code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let restaurant: string;
  let menu: string;
  try {
    const body = await request.json();
    restaurant = String(body.restaurant ?? "").trim();
    menu = String(body.menu ?? "").trim();
    if (!restaurant || !menu) throw new Error("restaurant and menu required");
  } catch {
    return NextResponse.json(
      { error: "店名とメニュー名を入力してください。" },
      { status: 400 }
    );
  }

  try {
    const prompt = [
      `「${restaurant}」というお店の「${menu}」というメニューについて、`,
      "そのお店が公式サイトなどで公開している栄養成分情報(カロリーkcal、タンパク質g、脂質g、炭水化物g)を検索してください。",
      "公式情報が見つからない場合は、信頼できる情報源の値でも構いませんが、その旨を note に書いてください。",
      "回答は必ず次の JSON 形式のみで出力してください(コードブロックや説明文は不要):",
      "{",
      '  "found": true または false,',
      '  "food_name": "店名 メニュー名",',
      '  "calories": 数値(kcal),',
      '  "protein_g": 数値,',
      '  "fat_g": 数値,',
      '  "carbs_g": 数値,',
      '  "note": "情報源や注意点(例: 公式サイトの栄養成分表より)"',
      "}",
      "栄養情報がまったく見つからない場合は found を false にし、数値は 0 にしてください。",
    ].join("\n");

    const { response } = await generateContent(ai, {
      label: LABEL,
      timeoutMs: TEXT_TIMEOUT_MS,
      contents: prompt,
      config: {
        // Google 検索グラウンディング(JSON モードとは併用不可のためプロンプトで JSON を指示)
        tools: [{ googleSearch: {} }],
      },
    });

    const text = extractText(response, LABEL);
    const parsed = parseJsonFromText(text) as Record<string, unknown> | null;
    if (!parsed) {
      console.error(
        `[gemini] ${LABEL} unexpected response shape: ${text.slice(0, 300)}`
      );
    }

    if (!parsed || parsed.found !== true) {
      return NextResponse.json({
        found: false,
        note:
          typeof parsed?.note === "string"
            ? parsed.note
            : "栄養情報が見つかりませんでした。",
      });
    }

    return NextResponse.json({
      found: true,
      item: {
        food_name:
          typeof parsed.food_name === "string" && parsed.food_name.trim()
            ? parsed.food_name.slice(0, 100)
            : `${restaurant} ${menu}`,
        amount_g: null,
        protein_g: toNonNegativeNumber(parsed.protein_g),
        fat_g: toNonNegativeNumber(parsed.fat_g),
        carbs_g: toNonNegativeNumber(parsed.carbs_g),
        calories: toNonNegativeNumber(parsed.calories),
      },
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 300) : null,
    });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} responding ${failure.status} ${failure.code}`);
    return NextResponse.json(failureBody(failure), { status: failure.status });
  }
}
