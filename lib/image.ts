/**
 * 画像をブラウザ側で縮小して JPEG にするヘルパー(クライアント専用)。
 *
 * iPhone で撮った写真はそのままだと数 MB あり、
 * アップロードにも Gemini の解析にも時間がかかるため、
 * 送る前に長辺を縮めて JPEG に変換する。
 */

/** 画像を縮小して JPEG の Blob と base64 に変換(通信量と解析コストを抑える) */
export async function compressImage(
  file: File,
  maxSize = 1024,
  quality = 0.8
): Promise<{ blob: Blob; base64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    el.src = dataUrl;
  });
  const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpegUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = jpegUrl.split(",")[1];
  const blob = await (await fetch(jpegUrl)).blob();
  return { blob, base64 };
}
