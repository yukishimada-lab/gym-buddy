import type { MyProduct, MyProductBasis } from "@/lib/types";

/**
 * マイ商品まわりの計算・並べ替え・名前マッチングのヘルパー。
 *
 * マイ商品の栄養値は「basis(基準量)あたり」で保存されている。
 *   per_100g    → 100g あたり
 *   per_serving → 1食(1袋・1回分)あたり
 *   per_piece   → 1個あたり
 * 記録するときはここで実際の摂取量に換算する。
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

export const BASIS_OPTIONS: { value: MyProductBasis; label: string }[] = [
  { value: "per_100g", label: "100gあたり" },
  { value: "per_serving", label: "1食あたり" },
  { value: "per_piece", label: "1個あたり" },
];

export function basisLabel(basis: MyProductBasis): string {
  return BASIS_OPTIONS.find((o) => o.value === basis)?.label ?? "100gあたり";
}

/** 数える単位(1食 → 「食」、1個 → 「個」)。100g 基準の商品には単位が無いので null */
export function countUnit(basis: MyProductBasis): string | null {
  if (basis === "per_serving") return "食";
  if (basis === "per_piece") return "個";
  return null;
}

/** その商品を「グラム」で指定できるか(100g 基準、または 1食/1個 の重量が分かっている) */
export function canUseGrams(product: MyProduct): boolean {
  return product.basis === "per_100g" || Number(product.serving_g) > 0;
}

export type Nutrition = {
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  calories: number;
};

/** 基準量あたりの値をそのまま取り出す(DB からは文字列で来ることがあるので数値化する) */
export function basisNutrition(product: MyProduct): Nutrition {
  return {
    protein_g: Number(product.protein_g) || 0,
    fat_g: Number(product.fat_g) || 0,
    carbs_g: Number(product.carbs_g) || 0,
    calories: Number(product.calories) || 0,
  };
}

/**
 * 100g あたりに換算した値。
 * 1食 / 1個 の重量(serving_g)が分からない商品は換算できないので null。
 */
export function per100(product: MyProduct): Nutrition | null {
  const n = basisNutrition(product);
  if (product.basis === "per_100g") return n;
  const g = Number(product.serving_g);
  if (!Number.isFinite(g) || g <= 0) return null;
  const k = 100 / g;
  return {
    protein_g: round1(n.protein_g * k),
    fat_g: round1(n.fat_g * k),
    carbs_g: round1(n.carbs_g * k),
    calories: round1(n.calories * k),
  };
}

/** 1食 / 1個 あたりに換算した値(100g 基準の商品でも serving_g があれば出せる) */
export function perServing(product: MyProduct): Nutrition | null {
  const n = basisNutrition(product);
  if (product.basis !== "per_100g") return n;
  const g = Number(product.serving_g);
  if (!Number.isFinite(g) || g <= 0) return null;
  const k = g / 100;
  return {
    protein_g: round1(n.protein_g * k),
    fat_g: round1(n.fat_g * k),
    carbs_g: round1(n.carbs_g * k),
    calories: round1(n.calories * k),
  };
}

/** 摂取量の指定方法 */
export type AmountMode = "grams" | "count";

/**
 * 「何g」または「何個(何食分)」から実際の摂取量を計算する。
 * 換算できない組み合わせ(1食あたりの商品をグラム指定、など)は null を返す。
 */
export function calcIntake(
  product: MyProduct,
  mode: AmountMode,
  quantity: number
): { nutrition: Nutrition; amount_g: number | null } | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;

  if (mode === "count") {
    const unit = perServing(product);
    if (!unit) return null;
    const servingG = Number(product.serving_g);
    return {
      nutrition: {
        protein_g: round1(unit.protein_g * quantity),
        fat_g: round1(unit.fat_g * quantity),
        carbs_g: round1(unit.carbs_g * quantity),
        calories: round1(unit.calories * quantity),
      },
      amount_g:
        Number.isFinite(servingG) && servingG > 0
          ? round1(servingG * quantity)
          : null,
    };
  }

  const hundred = per100(product);
  if (!hundred) return null;
  const k = quantity / 100;
  return {
    nutrition: {
      protein_g: round1(hundred.protein_g * k),
      fat_g: round1(hundred.fat_g * k),
      carbs_g: round1(hundred.carbs_g * k),
      calories: round1(hundred.calories * k),
    },
    amount_g: round1(quantity),
  };
}

/** 一覧に出す 1 行の要約(例:「100gあたり 380kcal / P7 F2 C82」) */
export function summaryLine(product: MyProduct): string {
  const n = basisNutrition(product);
  const g =
    product.basis !== "per_100g" && Number(product.serving_g) > 0
      ? `(${Number(product.serving_g)}g)`
      : "";
  return `${basisLabel(product.basis)}${g} ${Math.round(n.calories)}kcal / P${round1(
    n.protein_g
  )} F${round1(n.fat_g)} C${round1(n.carbs_g)}`;
}

/**
 * よく使う順に並べ替える。
 * お気に入り → 使用回数の多い順 → 最近使った順 → 名前順。
 */
export function sortByUsage(products: MyProduct[]): MyProduct[] {
  return [...products].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    const useDiff = (Number(b.use_count) || 0) - (Number(a.use_count) || 0);
    if (useDiff !== 0) return useDiff;
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (aUsed !== bUsed) return bUsed - aUsed;
    return a.name.localeCompare(b.name, "ja");
  });
}

// ------------------------------------------------------------
// 写真からの食事推定と、登録済みマイ商品の名前マッチング
// ------------------------------------------------------------

/**
 * 比較用に名前をならす。
 * 全角→半角、大文字→小文字、記号・空白の除去。
 * 「〇〇社 コーンフレーク」と「コーンフレーク」を近づけたいので、
 * カッコの中身も落とす。
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/[\s.,・/\-_'"’”「」【】]/g, "");
}

/** 2 文字ずつの並び(バイグラム)の集合。1 文字しかない語はその 1 文字 */
function bigrams(s: string): Set<string> {
  if (s.length <= 1) return new Set(s ? [s] : []);
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * 名前の近さを 0〜1 で返す(ダイス係数)。
 * 片方がもう片方を丸ごと含む場合は「一致」とみなして高い値を返す。
 */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // 「コーンフレーク」と「〇〇社コーンフレーク」のような包含関係
  if (x.length >= 3 && y.includes(x)) return 0.95;
  if (y.length >= 3 && x.includes(y)) return 0.95;

  const bx = bigrams(x);
  const by = bigrams(y);
  let common = 0;
  bx.forEach((g) => {
    if (by.has(g)) common++;
  });
  return (2 * common) / (bx.size + by.size);
}

/** 名前が十分に近いとみなすしきい値 */
export const MATCH_THRESHOLD = 0.5;

/**
 * 推定された食品名にいちばん近いマイ商品を返す(近いものが無ければ null)。
 * 写真からの推定値より、ユーザーが登録した正確な数値を優先するために使う。
 */
export function findMatchingProduct(
  foodName: string,
  products: MyProduct[]
): MyProduct | null {
  let best: MyProduct | null = null;
  let bestScore = 0;
  for (const p of products) {
    const score = Math.max(
      nameSimilarity(foodName, p.name),
      p.maker ? nameSimilarity(foodName, `${p.maker}${p.name}`) : 0
    );
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}
