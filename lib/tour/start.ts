import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour.css";
import { TOURS } from "./steps";
import type { TourId, TourStep } from "./types";

/**
 * 実画面をハイライトしながら操作を説明するツアー(driver.js / MIT)。
 *
 * このファイルは「?」ボタンを押したときに動的 import される。
 * 最初の表示にはライブラリも CSS も含まれないので、PWA の初回読み込みは重くならない。
 */

/** 同時に 2 つ走らないよう、動いているツアーを覚えておく */
let active: Driver | null = null;

function selectorFor(step: TourStep): string {
  return `[data-tour="${step.target}"]`;
}

/**
 * 画面に無い要素のステップを落とす。
 *
 * 記録が 0 件の新規ユーザーだと種目カードなどがそもそも存在しない。
 * 落としておけば「1 / 8」の番号もその人の画面に合った数になる。
 */
function availableSteps(id: TourId): DriveStep[] {
  return TOURS[id]
    .filter((step) => !step.target || document.querySelector(selectorFor(step)))
    .map((step) => ({
      element: step.target ? selectorFor(step) : undefined,
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
        align: step.align,
      },
    }));
}

export function startTour(id: TourId): void {
  if (typeof document === "undefined") return;

  active?.destroy();

  const steps = availableSteps(id);
  if (steps.length === 0) return;

  const tour = driver({
    steps,
    // 画面外の要素はスクロールして見える位置に持ってくる
    smoothScroll: true,
    // ハイライト中の要素は押せなくする(説明中に削除ボタンを触ってしまう事故を防ぐ)
    disableActiveInteraction: true,
    // 表示の途中で要素が消えても止まらないようにする
    skipMissingElement: true,
    allowClose: true,
    overlayColor: "#0f172a",
    overlayOpacity: 0.65,
    stagePadding: 6,
    stageRadius: 12,
    popoverOffset: 12,
    popoverClass: "gym-tour",
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "次へ",
    prevBtnText: "戻る",
    doneBtnText: "終わる",
    onPopoverRender: (popover) => {
      // × だけだと閉じられると気づきにくいので、文字でも示す
      popover.closeButton.textContent = "スキップ";
      popover.closeButton.setAttribute("aria-label", "使い方ガイドを閉じる");
    },
    onDestroyed: () => {
      active = null;
    },
  });

  active = tour;
  tour.drive();
}
