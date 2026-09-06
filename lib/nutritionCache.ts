/**
 * 栄養情報キャッシュ(nutrition_cache テーブル)の共通処理。
 *
 * AI に一度問い合わせた栄養情報は DB に貯めておき、同じものを 2 回目以降は
 * ネットに出ずに返す。「豚バラ 100g の栄養価」「松屋の牛丼特盛のカロリー」は
 * 誰が調べても同じ値なので、全ユーザーで 1 つのキャッシュを共有している。
 *
 * ここには検索キーの作り方だけを置く(DB アクセスは API ルート側)。
 * キーの作り方がぶれると同じ食品が何度も登録されてキャッシュが効かないため、
 * 1 か所にまとめてテストしている。
 */

/** キャッシュの種類 */
export type NutritionCacheKind = "food" | "restaurant";

/**
 * 表記ゆれをそろえる。
 *
 * - NFKC 正規化: 全角英数を半角に、半角カナを全角にそろえる
 *   (「ﾏﾂﾔ」「ＭＡＴＳＵＹＡ」と「まつや」を別物にしない)
 * - 前後の空白を落とし、連続する空白は 1 つにまとめる
 * - 英字は小文字にそろえる
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 一般的な食材・料理のキー(例: 「豚バラ」) */
export function foodCacheKey(name: string): string {
  return normalizeName(name);
}

/**
 * 外食メニューのキー(例: 「松屋|牛丼特盛」)。
 * 店名とメニュー名は "|" で区切る。どちらか片方だけでは特定できないため。
 */
export function restaurantCacheKey(restaurant: string, menu: string): string {
  return `${normalizeName(restaurant)}|${normalizeName(menu)}`;
}

/** DB に入っているキャッシュ 1 行(必要な列だけ) */
export type NutritionCacheRow = {
  id: string;
  kind: NutritionCacheKind;
  cache_key: string;
  display_name: string;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  calories: number;
  serving_g: number | null;
  note: string | null;
  source: "ai" | "ai_search";
};
