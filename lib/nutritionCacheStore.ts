import type { SupabaseClient } from "@supabase/supabase-js";
import type { NutritionCacheKind, NutritionCacheRow } from "./nutritionCache";

/**
 * nutrition_cache テーブルの読み書き(サーバー専用)。
 *
 * ここでの方針: キャッシュはあくまで高速化のための飾りなので、
 * 読み書きに失敗しても機能自体は止めない。
 * (マイグレーション未適用の環境でも、AI に聞きにいけばちゃんと動く)
 */

const TABLE = "nutrition_cache";

const COLUMNS =
  "id, kind, cache_key, display_name, protein_g, fat_g, carbs_g, calories, serving_g, note, source";

/** キャッシュを引く。無ければ null(エラーのときも null にして AI に進む) */
export async function readNutritionCache(
  supabase: SupabaseClient,
  kind: NutritionCacheKind,
  cacheKey: string
): Promise<NutritionCacheRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("kind", kind)
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) {
    console.error(`[cache] 読み取りに失敗しました kind=${kind}: ${error.message}`);
    return null;
  }
  return (data as NutritionCacheRow | null) ?? null;
}

/** 使われた回数を 1 増やす(失敗しても無視してよい統計値) */
export async function touchNutritionCache(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.rpc("touch_nutrition_cache", { p_id: id });
  if (error) {
    console.error(`[cache] 使用回数の更新に失敗しました: ${error.message}`);
  }
}

/**
 * AI に聞いた結果をキャッシュに保存する。
 * 同じキーが既にあれば新しい値で上書きする(取り直しに対応するため)。
 */
export async function writeNutritionCache(
  supabase: SupabaseClient,
  row: Omit<NutritionCacheRow, "id"> & { created_by: string }
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "kind,cache_key" });

  if (error) {
    console.error(
      `[cache] 保存に失敗しました kind=${row.kind} key=${row.cache_key}: ${error.message}`
    );
  }
}
