/**
 * PWA 用のアイコン / スプラッシュ画像を生成するスクリプト。
 *
 *   node scripts/generate-icons.mjs
 *
 * 画像素材(Figma などの外部ツール)に依存せず、Node の標準機能だけで
 * ダンベルのロゴを描いて PNG に書き出します。生成物は public/ 配下に
 * コミットしてあるので、デザインを変えたいときだけ再実行してください。
 * デザインの元データは public/icons/icon.svg と同じ形状です。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** ブランドカラー(Tailwind の blue-600 前後。アクティブなナビと揃えている) */
const BRAND_FROM = [59, 130, 246]; // #3b82f6
const BRAND_TO = [29, 78, 216]; // #1d4ed8
/** アプリの背景色(globals.css の --background と揃える) */
const APP_BG = [244, 245, 247]; // #f4f5f7

/** 1 ピクセルあたりのスーパーサンプリング数(アンチエイリアス用) */
const SS = 4;

// ---------------------------------------------------------------- 図形の判定

/** 角丸長方形の内側かどうか。中心 (cx, cy)、幅 w、高さ h、角丸半径 r */
function inRoundedRect(x, y, cx, cy, w, h, r) {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  if (dx <= 0 || dy <= 0) {
    return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
  }
  return dx * dx + dy * dy <= r * r;
}

/**
 * ダンベルの形状。中心を原点とした ±0.5 の座標系で定義し、
 * -30 度傾けた状態でちょうど ±0.5 に収まるようにしてある。
 */
const DUMBBELL = [
  { cx: 0, cy: 0, w: 0.4, h: 0.135, r: 0.067 }, // シャフト
  { cx: -0.265, cy: 0, w: 0.15, h: 0.46, r: 0.07 }, // 内側のプレート(左)
  { cx: 0.265, cy: 0, w: 0.15, h: 0.46, r: 0.07 }, // 内側のプレート(右)
  { cx: -0.415, cy: 0, w: 0.105, h: 0.28, r: 0.052 }, // 外側のカラー(左)
  { cx: 0.415, cy: 0, w: 0.105, h: 0.28, r: 0.052 }, // 外側のカラー(右)
];

const ANGLE = (-30 * Math.PI) / 180;
const COS = Math.cos(ANGLE);
const SIN = Math.sin(ANGLE);

/**
 * 画像座標 (px 単位) がダンベルの内側かどうか。
 * glyphSize はダンベルの外接正方形の一辺、(gx, gy) はその中心。
 */
function inDumbbell(px, py, gx, gy, glyphSize) {
  // 中心を原点に戻して正規化し、逆回転させてから軸並行の判定にかける
  const nx = (px - gx) / glyphSize;
  const ny = (py - gy) / glyphSize;
  const x = nx * COS + ny * SIN;
  const y = -nx * SIN + ny * COS;
  return DUMBBELL.some((s) => inRoundedRect(x, y, s.cx, s.cy, s.w, s.h, s.r));
}

// ---------------------------------------------------------------- PNG 出力

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = buildCrcTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    crc = (crc >>> 8) ^ table[c];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA のピクセル配列を PNG(8bit RGBA)にエンコードする */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 描画

/**
 * ロゴのタイルを描く。
 * - shape: "rounded"(角丸四角) / "square"(全面塗り。maskable と iOS 用)
 * - glyphRatio: タイルの一辺に対するダンベルの大きさ
 */
function drawTile(rgba, width, tileX, tileY, tileSize, shape, glyphRatio) {
  const radius = tileSize * 0.225;
  const glyphSize = tileSize * glyphRatio;
  const gx = tileX + tileSize / 2;
  const gy = tileY + tileSize / 2;
  const x0 = Math.max(0, Math.floor(tileX));
  const y0 = Math.max(0, Math.floor(tileY));
  const x1 = Math.min(width, Math.ceil(tileX + tileSize));
  const y1 = Math.min(rgba.length / 4 / width, Math.ceil(tileY + tileSize));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let bgHits = 0;
      let glyphHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const insideTile =
            shape === "square"
              ? px >= tileX && px <= tileX + tileSize &&
                py >= tileY && py <= tileY + tileSize
              : inRoundedRect(
                  px, py,
                  tileX + tileSize / 2, tileY + tileSize / 2,
                  tileSize, tileSize, radius
                );
          if (!insideTile) continue;
          bgHits++;
          if (inDumbbell(px, py, gx, gy, glyphSize)) glyphHits++;
        }
      }
      if (bgHits === 0) continue;

      const total = SS * SS;
      const tileAlpha = bgHits / total;
      const glyphAlpha = glyphHits / total;
      // 斜めのグラデーション(左上を明るく、右下を濃く)
      const t = ((x - tileX) / tileSize + (y - tileY) / tileSize) / 2;
      const clamped = Math.min(1, Math.max(0, t));
      const bg = BRAND_FROM.map((from, i) =>
        Math.round(from + (BRAND_TO[i] - from) * clamped)
      );
      // 背景の上に白いダンベルを重ねる(タイル内でのアルファ合成)
      const gk = tileAlpha === 0 ? 0 : glyphAlpha / tileAlpha;
      const color = bg.map((c) => Math.round(c * (1 - gk) + 255 * gk));

      const i = (y * width + x) * 4;
      const dstA = rgba[i + 3] / 255;
      const outA = tileAlpha + dstA * (1 - tileAlpha);
      for (let c = 0; c < 3; c++) {
        const src = color[c] / 255;
        const dst = rgba[i + c] / 255;
        rgba[i + c] = Math.round(
          ((src * tileAlpha + dst * dstA * (1 - tileAlpha)) / (outA || 1)) * 255
        );
      }
      rgba[i + 3] = Math.round(outA * 255);
    }
  }
}

function fill(rgba, color) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = color[0];
    rgba[i + 1] = color[1];
    rgba[i + 2] = color[2];
    rgba[i + 3] = 255;
  }
}

function write(relPath, buffer) {
  const abs = join(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  console.log(`${relPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

/** アイコン: 角丸タイル + 透過背景 */
function makeIcon(size, { shape, glyphRatio, opaqueBg }) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  if (opaqueBg) fill(rgba, opaqueBg);
  drawTile(rgba, size, 0, 0, size, shape, glyphRatio);
  return encodePng(size, size, rgba);
}

/** スプラッシュ: アプリ背景色 + 中央にロゴタイル */
function makeSplash(width, height) {
  const rgba = Buffer.alloc(width * height * 4, 0);
  fill(rgba, APP_BG);
  const tile = Math.round(Math.min(width, height) * 0.3);
  drawTile(
    rgba, width,
    Math.round((width - tile) / 2),
    Math.round((height - tile) / 2),
    tile, "rounded", 0.62
  );
  return encodePng(width, height, rgba);
}

// ---------------------------------------------------------------- 生成

// 通常アイコン(角丸・透過)
for (const size of [192, 512]) {
  write(
    `public/icons/icon-${size}.png`,
    makeIcon(size, { shape: "rounded", glyphRatio: 0.62 })
  );
}

// maskable(全面塗り。OS 側で好きな形に切り抜かれるので中央 80% に収める)
for (const size of [192, 512]) {
  write(
    `public/icons/icon-maskable-${size}.png`,
    makeIcon(size, { shape: "square", glyphRatio: 0.52 })
  );
}

// iOS のホーム画面用(角丸は iOS が付けるので全面塗り・透過なし)
write(
  "public/icons/apple-touch-icon.png",
  makeIcon(180, { shape: "square", glyphRatio: 0.6 })
);

// ファビコン代わりの小さめ PNG
write(
  "public/icons/icon-32.png",
  makeIcon(32, { shape: "rounded", glyphRatio: 0.68 })
);

// iOS のスプラッシュ画像(主要な iPhone のみ)
export const SPLASH_TARGETS = [
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

for (const t of SPLASH_TARGETS) {
  write(`public/splash/splash-${t.w}x${t.h}.png`, makeSplash(t.w, t.h));
}
