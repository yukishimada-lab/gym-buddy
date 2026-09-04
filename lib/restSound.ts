/**
 * 休憩タイマーの通知音(クライアント専用)。
 *
 * iOS Safari では音を出す前に「ユーザーの操作の中で」AudioContext を作る/再開する
 * 必要がある。そのため、タイマーを開始したタップの中で unlockAudio() を呼び、
 * 実際に鳴らすのは時間になってから、という作りにしている。
 *
 * 音声ファイルは使わず Web Audio で合成する。
 * ファイルの読み込み待ちがなく、オフライン(PWA)でも確実に鳴るため。
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** この端末で音を鳴らせるか */
export function isAudioSupported(): boolean {
  return getCtor() !== null;
}

/**
 * 音を出せる状態にする。**必ずタップ等の操作の中から呼ぶこと。**
 * 鳴らせる見込みなら true。
 */
export function unlockAudio(): boolean {
  const Ctor = getCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

/** 画面に戻ってきたときなどに、止まっていたら再開する */
export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") {
    try {
      void ctx.resume();
    } catch {
      // 操作なしでは再開できないことがある。次のタップで unlockAudio() が拾う。
    }
  }
}

/** ピッ 1 回。start は ctx.currentTime からの相対秒 */
function scheduleBeep(
  audio: AudioContext,
  start: number,
  duration: number,
  frequency: number,
  volume: number
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  // 音の立ち上がり/終わりを滑らかにしないと「プツッ」というノイズが入る
  const t0 = audio.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export type BeepKind =
  /** 残り 3・2・1 秒のカウントダウン */
  | "tick"
  /** 休憩終了 */
  | "finish";

/** 通知音を鳴らす。鳴らせなかった場合は false。 */
export function playBeep(kind: BeepKind): boolean {
  if (!unlockAudio() || !ctx) return false;
  try {
    if (kind === "tick") {
      scheduleBeep(ctx, 0, 0.09, 660, 0.25);
    } else {
      // 終了は 3 連。トレーニング中でも気づけるよう少し高く・長めに鳴らす
      scheduleBeep(ctx, 0, 0.16, 880, 0.4);
      scheduleBeep(ctx, 0.22, 0.16, 880, 0.4);
      scheduleBeep(ctx, 0.44, 0.34, 1175, 0.45);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 振動(対応端末のみ)。
 * iOS Safari は Vibration API 非対応なので実際には何も起きないが、
 * Android など対応端末では音が消えていても気づける。
 */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  try {
    nav.vibrate?.(pattern);
  } catch {
    // 非対応なら何もしない
  }
}
