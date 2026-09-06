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
import { restaurantCacheKey } from "@/lib/nutritionCache";
import {
  readNutritionCache,
  touchNutritionCache,
  writeNutritionCache,
} from "@/lib/nutritionCacheStore";

// Google 検索グラウンディングは時間がかかることがあるため上限を延長
export const maxDuration = 60;

const LABEL = "restaurant-search";

/**
 * POST /api/meals/restaurant-search
 * body: { restaurant: string, menu: string }
 *
 * 店名+メニュー名から、公式に公開されている栄養成分情報を返す。
 *
 * 1. まず nutrition_cache(過去に誰かが調べた結果)を引く。
 *    外食チェーンのメニューの栄養成分は頻繁には変わらないので、
 *    2 回目以降はネット検索せずここから即座に返せる。
 * 2. 無ければ Gemini の Google 検索グラウンディングで調べ、結果を保存する。
 *
 * 使うほどキャッシュが育ち、速く・安く・つながりにくい場所でも動くようになる。
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

  const cacheKey = restaurantCacheKey(restaurant, menu);

  // 1. 過去に調べた結果があればネット検索せずに返す
  const cached = await readNutritionCache(supabase, "restaurant", cacheKey);
  if (cached) {
    void touchNutritionCache(supabase, cached.id);
    console.log(`[cache] ${LABEL} hit key=${cacheKey}`);
    return NextResponse.json({
      found: true,
      cached: true,
      item: {
        food_name: cached.display_name,
        amount_g: cached.serving_g,
        protein_g: cached.protein_g,
        fat_g: cached.fat_g,
        carbs_g: cached.carbs_g,
        calories: cached.calories,
      },
      note: cached.note,
    });
  }

  // 2. 無ければ AI に検索してもらう
  const ai = getGeminiClient();
  if (!ai) {
    console.error(`[gemini] ${LABEL} aborted: GEMINI_API_KEY is not set`);
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE, code: "NOT_CONFIGURED" },
      { status: 503 }
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

    const displayName =
      typeof parsed.food_name === "string" && parsed.food_name.trim()
        ? parsed.food_name.slice(0, 100)
        : `${restaurant} ${menu}`;
    const note =
      typeof parsed.note === "string" ? parsed.note.slice(0, 300) : null;
    const item = {
      food_name: displayName,
      // 外食の栄養成分は「1 食あたり」で公開されている。グラム数は普通ぶら下がって
      // いないので null(ユーザーが必要なら手で入れる)。
      amount_g: null,
      protein_g: toNonNegativeNumber(parsed.protein_g),
      fat_g: toNonNegativeNumber(parsed.fat_g),
      carbs_g: toNonNegativeNumber(parsed.carbs_g),
      calories: toNonNegativeNumber(parsed.calories),
    };

    // 3. 次に誰かが同じメニューを調べたとき、検索せずに返せるよう保存する
    void writeNutritionCache(supabase, {
      kind: "restaurant",
      cache_key: cacheKey,
      display_name: displayName,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carbs_g: item.carbs_g,
      calories: item.calories,
      serving_g: null,
      note,
      source: "ai_search",
      created_by: user.id,
    });

    return NextResponse.json({ found: true, cached: false, item, note });
  } catch (e) {
    const failure = describeGeminiError(e);
    console.error(`[gemini] ${LABEL} responding ${failure.status} ${failure.code}`);
    return NextResponse.json(failureBody(failure), { status: failure.status });
  }
}
