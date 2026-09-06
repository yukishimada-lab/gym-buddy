/**
 * 休憩タイマーの通知音(クライアント専用)。
 *
 * iOS Safari では音を出す前に「ユーザーの操作の中で」AudioContext を作る/再開する
 * 必要がある。そのため、タイマーを開始したタップの中で unlockAudio() を呼び、
 * 実際に鳴らすのは時間になってから、という作りにしている。
 *
 * 音声ファイルは使わず、その場で音を合成する。
 * ファイルの読み込み待ちがなく、オフライン(PWA)でも確実に鳴るため。
 *
 * 鳴らし方は 2 通りある。
 *
 * 1. 予約再生(startScheduledAlarm) … 画面ロック中でも鳴らしたいとき
 *    「無音 → 予告音 → 終了音」をつないだ音声を作り、休憩開始と同時に流す。
 *    いったん再生を始めた音は画面を消しても鳴り続けるので、
 *    JavaScript のタイマーが止まる画面ロック中でも予定どおり鳴る。
 *
 * 2. その場で鳴らす(playBeep) … 画面が点いているときの従来どおりの鳴らし方。
 *    予約再生が使えない場合(10 分超の休憩、再生を許可されなかった端末)の
 *    受け皿でもある。
 */

import {
  FINISH_REPEATS,
  MAX_SCHEDULED_SECONDS,
  alarmTotalSeconds,
  renderAlarmWav,
} from "./restAlarm";

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
      // 終了音は「ピッ ピッ ポーン」を FINISH_REPEATS 回。
      // 1 回だと短くて、トレーニング中や騒がしいジムでは気づけないため。
      for (let i = 0; i < FINISH_REPEATS; i++) {
        const base = i * 1.2;
        scheduleBeep(ctx, base, 0.16, 880, 0.45);
        scheduleBeep(ctx, base + 0.22, 0.16, 880, 0.45);
        scheduleBeep(ctx, base + 0.44, 0.34, 1175, 0.5);
      }
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

// ------------------------------------------------------------
// 予約再生(画面ロック中でも鳴らす)
// ------------------------------------------------------------

/** 再生中の音声。null なら予約再生していない。 */
let alarmAudio: HTMLAudioElement | null = null;
/** 音声データの一時 URL。使い終わったら必ず開放する(放っておくとメモリに残る) */
let alarmUrl: string | null = null;

/**
 * iOS の「音の扱い方」を指定する(Safari 16.4 以降)。
 *
 *   playback … 音楽アプリと同じ扱い。画面を消しても鳴り続ける代わりに、
 *              再生中は他のアプリの音楽が止まる。
 *   auto     … ブラウザ任せ(既定)。
 */
function setAudioSessionType(type: "playback" | "auto"): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = type;
  } catch {
    // 非対応のブラウザでは何も起きない
  }
}

/** 秒数を 1:30 のように表す(ロック画面の表示用) */
function shortDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * ロック画面・通知領域に出る情報を設定する。
 *
 * 音声を再生している間、iPhone のロック画面には音楽と同じ形の
 * 再生パネルが出る。そこに種目名と休憩の長さを出し、
 * 進み具合(残り時間)は音声の再生位置がそのまま反映される。
 */
function setLockScreenInfo(exerciseName: string, restSeconds: number): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `休憩中 ${shortDuration(restSeconds)}`,
      artist: exerciseName,
      album: "gym-buddy",
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    navigator.mediaSession.playbackState = "playing";
    navigator.mediaSession.setPositionState?.({
      duration: alarmTotalSeconds(restSeconds),
      position: 0,
      playbackRate: 1,
    });
  } catch {
    // 対応していない端末では表示されないだけで、音は鳴る
  }
}

function clearLockScreenInfo(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  } catch {
    // 何もしない
  }
}

/** 予約再生を止めて後片付けする */
export function stopScheduledAlarm(): void {
  const audio = alarmAudio;
  const url = alarmUrl;
  alarmAudio = null;
  alarmUrl = null;
  try {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  } catch {
    // 片付けの失敗は無視してよい
  }
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // 同上
    }
  }
  setAudioSessionType("auto");
  clearLockScreenInfo();
}

/** 予約再生が動いているか(動いていれば、時間になっても別途鳴らす必要はない) */
export function isScheduledAlarmActive(): boolean {
  return alarmAudio != null && !alarmAudio.ended;
}

/** この長さの休憩を予約再生でまかなえるか */
export function canScheduleAlarm(remainingSeconds: number): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.Audio !== "undefined" &&
    remainingSeconds > 0 &&
    remainingSeconds <= MAX_SCHEDULED_SECONDS
  );
}

/**
 * 「残り remainingSeconds 秒後に鳴る音声」を今から再生する。
 * **必ずタップ等の操作の中から呼ぶこと**(操作なしの再生は端末に拒否される)。
 *
 * @returns 再生を始められたら true
 */
export function startScheduledAlarm(
  remainingSeconds: number,
  exerciseName: string
): boolean {
  stopScheduledAlarm();
  if (!canScheduleAlarm(remainingSeconds)) return false;

  try {
    const wav = renderAlarmWav(remainingSeconds);
    const blob = new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "auto";

    alarmAudio = audio;
    alarmUrl = url;

    // 画面を消しても鳴らしたいので、音楽アプリと同じ扱いにしてもらう
    setAudioSessionType("playback");

    audio.addEventListener("ended", () => stopScheduledAlarm(), { once: true });

    void audio.play().catch(() => {
      // 端末に再生を断られた場合は、その場で鳴らす方式に任せる
      stopScheduledAlarm();
    });

    setLockScreenInfo(exerciseName, remainingSeconds);
    return true;
  } catch {
    stopScheduledAlarm();
    return false;
  }
}
