/**
 * iOS のスプラッシュ画像(apple-touch-startup-image)の定義。
 *
 * iOS は端末ごとに「ピッタリのサイズ」の画像しか使ってくれないので、
 * 主要な iPhone の解像度ぶんだけメディアクエリと画像を並べる。
 * 画像は scripts/generate-icons.mjs が public/splash/ に生成する。
 * リストを増減させるときは、生成スクリプト側の SPLASH_TARGETS も合わせること。
 */
type SplashTarget = {
  /** 画像のピクセルサイズ */
  w: number;
  h: number;
  /** CSS ピクセルでの画面サイズと解像度(メディアクエリ用) */
  dw: number;
  dh: number;
  dpr: number;
};

const TARGETS: SplashTarget[] = [
  { w: 1320, h: 2868, dw: 440, dh: 956, dpr: 3 }, // iPhone 16 Pro Max
  { w: 1206, h: 2622, dw: 402, dh: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 1290, h: 2796, dw: 430, dh: 932, dpr: 3 }, // iPhone 15/14 Pro Max
  { w: 1179, h: 2556, dw: 393, dh: 852, dpr: 3 }, // iPhone 15/14 Pro
  { w: 1284, h: 2778, dw: 428, dh: 926, dpr: 3 }, // iPhone 12/13 Pro Max
  { w: 1170, h: 2532, dw: 390, dh: 844, dpr: 3 }, // iPhone 12/13/14
  { w: 1125, h: 2436, dw: 375, dh: 812, dpr: 3 }, // iPhone X/XS/11 Pro
  { w: 1242, h: 2688, dw: 414, dh: 896, dpr: 3 }, // iPhone XS Max/11 Pro Max
  { w: 828, h: 1792, dw: 414, dh: 896, dpr: 2 }, // iPhone XR/11
  { w: 750, h: 1334, dw: 375, dh: 667, dpr: 2 }, // iPhone SE/8
];

export const appleStartupImages = TARGETS.map(({ w, h, dw, dh, dpr }) => ({
  url: `/splash/splash-${w}x${h}.png`,
  media: `(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}));
