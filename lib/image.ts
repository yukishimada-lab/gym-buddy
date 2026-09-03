/**
 * 画像をブラウザ側で JPEG に変換・縮小するヘルパー(クライアント専用)。
 *
 * iPhone のカメラは標準で HEIC(HEIF)形式、しかも 1 枚数 MB〜十数 MB ある。
 * そのまま送るとアップロードにも解析にも時間がかかり、
 * Vercel のリクエストサイズ上限にも当たりやすい。
 * そこで送信前に必ず canvas を通して JPEG に変換し、長辺を縮めてから送る。
 * (iOS Safari は HEIC を自前でデコードできるので、canvas 経由なら JPEG になる)
 *
 * 失敗したときに「なぜ失敗したか」を日本語で出せるよう、
 * 原因ごとに ImageProcessingError を投げる。
 */

/** 変換に失敗した理由を日本語で持つエラー */
export class ImageProcessingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.code = code;
  }
}

export type CompressedImage = {
  blob: Blob;
  base64: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  /** 変換後のバイト数(デバッグ・ログ用) */
  bytes: number;
};

/** 送信する base64 の上限(Vercel のボディ上限 4.5MB より手前で抑える) */
const MAX_BASE64_LENGTH = 3_600_000;

/**
 * iOS Safari は canvas の総ピクセル数に上限があり(端末により 16.7M 前後)、
 * これを超えると描画結果が真っ白・真っ黒になる。
 * iPhone の 48MP 写真はこの上限を超えるため、面積でも上限をかける。
 */
const MAX_CANVAS_PIXELS = 4_000_000;

/** 受け付ける拡張子・MIME(iOS の HEIC を含む) */
const KNOWN_IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;

function isProbablyImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  // iOS では HEIC の type が空文字で渡ってくることがあるので拡張子でも見る
  return file.type === "" && KNOWN_IMAGE_EXT.test(file.name);
}

/** 長辺 maxSize・総ピクセル数 MAX_CANVAS_PIXELS に収まる描画サイズを求める */
function fitSize(width: number, height: number, maxSize: number) {
  let ratio = Math.min(1, maxSize / Math.max(width, height));
  const pixels = width * ratio * height * ratio;
  if (pixels > MAX_CANVAS_PIXELS) {
    ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
  }
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

type Decoded = {
  image: HTMLImageElement;
  /** canvas に描くサイズ(長辺・総ピクセル数の上限を適用済み) */
  width: number;
  height: number;
  release: () => void;
};

/**
 * 画像をデコードする。
 *
 * <img> + createObjectURL を使う。iOS Safari は HEIC を <img> でデコードでき、
 * EXIF の向き情報も自動で適用してくれるため、iPhone の写真ではこの経路が確実。
 * (以前は FileReader で data URL 化していたが、十数 MB の写真では
 *  base64 文字列がそのままメモリに載るため重かった)
 */
async function decodeImage(file: File, maxSize: number): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(
          new ImageProcessingError(
            "DECODE_FAILED",
            "この写真を読み込めませんでした。お使いのブラウザが対応していない形式(HEIC など)の可能性があります。カメラで撮り直すか、別の写真でお試しください。"
          )
        );
      el.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new ImageProcessingError(
        "DECODE_FAILED",
        "この写真を読み込めませんでした。カメラで撮り直すか、別の写真でお試しください。"
      );
    }
    const target = fitSize(img.naturalWidth, img.naturalHeight, maxSize);
    return {
      image: img,
      width: target.width,
      height: target.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** canvas に何も描かれていない(全ピクセルが透明)かどうかを小さな複製で確かめる */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 16;
  probe.height = 16;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  try {
    ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else
            reject(
              new ImageProcessingError(
                "ENCODE_FAILED",
                "写真を JPEG に変換できませんでした。別の写真でお試しください。"
              )
            );
        },
        "image/jpeg",
        quality
      );
      return;
    }
    // 古い実装向けのフォールバック
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const binary = atob(dataUrl.split(",")[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/jpeg" }));
    } catch {
      reject(
        new ImageProcessingError(
          "ENCODE_FAILED",
          "写真を JPEG に変換できませんでした。別の写真でお試しください。"
        )
      );
    }
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () =>
      reject(
        new ImageProcessingError(
          "READ_FAILED",
          "写真の読み込みに失敗しました。もう一度お試しください。"
        )
      );
    reader.readAsDataURL(blob);
  });
}

/**
 * 画像を長辺 maxSize px の JPEG に変換して Blob と base64 を返す。
 *
 * HEIC(iPhone 標準)を含め、ブラウザがデコードできる形式はすべて JPEG になる。
 * 変換後がまだ大きい場合は画質を落として送信サイズに収める。
 */
export async function compressImage(
  file: File,
  maxSize = 1500,
  quality = 0.82
): Promise<CompressedImage> {
  if (!isProbablyImage(file)) {
    throw new ImageProcessingError(
      "NOT_AN_IMAGE",
      "画像ファイルではないようです。写真を選び直してください。"
    );
  }

  const decoded = await decodeImage(file, maxSize);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ImageProcessingError(
        "NO_CANVAS",
        "この端末では写真の変換ができませんでした。別のブラウザでお試しください。"
      );
    }
    ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);

    // iOS でメモリ不足になると描画が空になる。空のまま送っても
    // 「認識できませんでした」としか出ないので、ここで原因を出す。
    if (isBlank(canvas)) {
      throw new ImageProcessingError(
        "BLANK_CANVAS",
        "写真を変換できませんでした(サイズが大きすぎる可能性があります)。他のアプリを閉じてから、もう一度お試しください。"
      );
    }

    // JPEG は透過を扱えないので、透過部分は白で埋める(黒く潰れるのを防ぐ)
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";

    let currentQuality = quality;
    let blob = await canvasToBlob(canvas, currentQuality);
    let base64 = await blobToBase64(blob);
    // 大きすぎる場合は画質を段階的に落として上限に収める
    while (base64.length > MAX_BASE64_LENGTH && currentQuality > 0.4) {
      currentQuality -= 0.15;
      blob = await canvasToBlob(canvas, currentQuality);
      base64 = await blobToBase64(blob);
    }
    if (!base64) {
      throw new ImageProcessingError(
        "ENCODE_FAILED",
        "写真を JPEG に変換できませんでした。別の写真でお試しください。"
      );
    }
    if (base64.length > MAX_BASE64_LENGTH) {
      throw new ImageProcessingError(
        "TOO_LARGE",
        "写真のデータが大きすぎます。カメラの設定を「高効率」にするか、別の写真でお試しください。"
      );
    }

    return {
      blob,
      base64,
      mimeType: "image/jpeg",
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
    };
  } finally {
    decoded.release();
  }
}

/** 例外を画面表示用の日本語メッセージにする(想定外の例外も拾えるように) */
export function imageErrorMessage(e: unknown): string {
  if (e instanceof ImageProcessingError) return e.message;
  return "写真の処理に失敗しました。別の写真でお試しください。";
}
