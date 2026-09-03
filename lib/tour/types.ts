/**
 * 使い方ガイド(操作ツアー)の型定義。
 *
 * ここには型しか置かない。ヘルプボタン側は `import type` で読み込むので、
 * ツアー本体(driver.js)は「?」を押すまで読み込まれない。
 */

/** ページごとのツアー。ページ側は data-tour 属性で説明したい要素に印を付ける */
export type TourId =
  | "record"
  | "meals"
  | "body"
  | "calendar"
  | "exercises"
  | "routines"
  | "products";

export type TourStep = {
  /**
   * ハイライトする要素の data-tour 属性の値。
   * 省略すると要素を指さずに吹き出しだけを画面中央に出す。
   * 画面に無いときはそのステップごと飛ばす(記録が 0 件のときなど)。
   */
  target?: string;
  title: string;
  /** 1〜2 文の平易な日本語で書く */
  description: string;
  /** 吹き出しを出す向き(省略時は driver.js が自動で決める) */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
};
