/**
 * 1 日サマリーの共有画像を書き出すときの計算。
 *
 * 画面に依存しない部分だけをここに置いてテストできるようにしている。
 */

/**
 * 書き出す画像の総ピクセル数の上限。
 *
 * iOS Safari には canvas の面積制限があり(おおよそ 1,600 万ピクセル)、
 * 超えると例外も出ないまま真っ白な画像になる。
 * セットを 1 行ずつ並べるようにしたぶん画像が縦に長くなったので、
 * 種目が多い日でも上限に当たらないよう、余裕をみて抑えておく。
 */
export const MAX_IMAGE_PIXELS = 10_000_000;

/** ふだんの精細さ(等倍の 2 倍で書き出す) */
const DEFAULT_PIXEL_RATIO = 2;

/**
 * 画像の精細さ(等倍の何倍で書き出すか)を決める。
 *
 * ふだんは 2 倍。長すぎる日だけ、面積が上限に収まるまで落とす。
 * 1 倍を下回ると文字がつぶれて読めなくなるので、そこで止める
 * (その場合は上限を超えるが、真っ白な画像より読める画像を選ぶ)。
 */
export function pixelRatioFor(
  widthPx: number,
  heightPx: number,
  maxPixels = MAX_IMAGE_PIXELS
): number {
  const area = Math.max(1, widthPx) * Math.max(1, heightPx);
  if (area * DEFAULT_PIXEL_RATIO ** 2 <= maxPixels) return DEFAULT_PIXEL_RATIO;
  // 面積は倍率の 2 乗で効くので、平方根で必要な倍率を出す
  const ratio = Math.sqrt(maxPixels / area);
  return Math.max(1, Math.round(ratio * 100) / 100);
}
