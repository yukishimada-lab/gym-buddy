/**
 * セット間の休憩タイマーの、画面に依存しない部分。
 *
 * 休憩の長さは種目ごとに違う(高重量のスクワットは 3 分、アームカールは 60 秒など)ので、
 * 種目ごとの秒数を localStorage に覚えておく。
 * DB に列を足すとマイグレーションが必要になり、すでに入っている記録に触ることになるため、
 * 端末内の設定として持つ方針にしている。
 */

/** よく使う休憩時間(秒)。ボタンで一発で選べるようにする。 */
export const REST_PRESETS = [30, 60, 90, 120, 180, 300];

export const DEFAULT_REST_SECONDS = 90;
export const MIN_REST_SECONDS = 5;
export const MAX_REST_SECONDS = 3600;

/** 秒数を m:ss 形式にする(60 秒未満でも 0:45 のように分から書く) */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 残り時間の表示。切り上げにする。
 *
 * 90 秒の休憩を始めた直後の残りは 89.99 秒なので、切り捨てだと
 * いきなり「1:29」と出てしまう。切り上げれば「1:30」から始まり、
 * 表示が 0:00 になった瞬間が本当の終了になる。
 */
export function formatCountdown(remainingMillis: number): string {
  return formatDuration(Math.ceil(Math.max(0, remainingMillis) / 1000));
}

/** 設定できる範囲に丸める */
export function clampRestSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REST_SECONDS;
  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, Math.round(value)));
}

/**
 * 残りミリ秒。終了時刻からの引き算で出すので、
 * iOS でアプリを裏に回して setInterval が止まっても、戻ってきた時点で正しい値になる。
 */
export function remainingMs(endsAt: number, now: number): number {
  return endsAt - now;
}

export type RestSettings = {
  /** 終了時に音を鳴らすか */
  sound: boolean;
  /** 記録を追加したら自動で休憩を始めるか */
  autoStart: boolean;
};

export const DEFAULT_REST_SETTINGS: RestSettings = {
  sound: true,
  autoStart: true,
};

const SECONDS_KEY = "gym-buddy.restSeconds.v1";
const SETTINGS_KEY = "gym-buddy.restSettings.v1";

/** localStorage は Safari のプライベートモードなどで例外を投げるので必ず包む */
function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくてもタイマー自体は使えるので握りつぶす
  }
}

/** 種目 ID → 休憩秒数 の対応表を読む(壊れた値は捨てる) */
export function loadRestSecondsMap(): Record<string, number> {
  const raw = readJson<Record<string, unknown>>(SECONDS_KEY);
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n >= MIN_REST_SECONDS && n <= MAX_REST_SECONDS) {
      out[id] = Math.round(n);
    }
  }
  return out;
}

/** その種目の休憩秒数を覚える。更新後の対応表を返す。 */
export function saveRestSecondsFor(
  map: Record<string, number>,
  exerciseId: string,
  seconds: number
): Record<string, number> {
  const next = { ...map, [exerciseId]: clampRestSeconds(seconds) };
  writeJson(SECONDS_KEY, next);
  return next;
}

/** その種目の休憩秒数(覚えていなければ既定値) */
export function restSecondsFor(
  map: Record<string, number>,
  exerciseId: string | null
): number {
  if (!exerciseId) return DEFAULT_REST_SECONDS;
  return map[exerciseId] ?? DEFAULT_REST_SECONDS;
}

export function loadRestSettings(): RestSettings {
  const raw = readJson<Partial<RestSettings>>(SETTINGS_KEY);
  if (!raw || typeof raw !== "object") return DEFAULT_REST_SETTINGS;
  return {
    sound:
      typeof raw.sound === "boolean" ? raw.sound : DEFAULT_REST_SETTINGS.sound,
    autoStart:
      typeof raw.autoStart === "boolean"
        ? raw.autoStart
        : DEFAULT_REST_SETTINGS.autoStart,
  };
}

export function saveRestSettings(settings: RestSettings): void {
  writeJson(SETTINGS_KEY, settings);
}

/** 実行中の休憩タイマー。終了時刻を絶対時刻で持つので、裏に回っても狂わない。 */
export type RestSession = {
  exerciseId: string;
  exerciseName: string;
  /** この休憩の長さ(秒) */
  durationSec: number;
  /** 終了予定時刻(epoch ms)。一時停止中は null */
  endsAt: number | null;
  /** 一時停止中の残りミリ秒。動作中は null */
  pausedMs: number | null;
};

const SESSION_KEY = "gym-buddy.restSession.v1";

/** 画面を移動したり再読み込みしても休憩が続くように、タブ内に保存しておく */
export function saveSession(session: RestSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // 保存できなくてもタイマー自体は動く
  }
}

/** 2 時間以上前に終わっているものは、消し忘れとみなして復元しない */
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function loadSession(now: number): RestSession | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RestSession>;
    if (
      typeof parsed?.exerciseId !== "string" ||
      typeof parsed?.exerciseName !== "string" ||
      typeof parsed?.durationSec !== "number"
    ) {
      return null;
    }
    const endsAt = typeof parsed.endsAt === "number" ? parsed.endsAt : null;
    const pausedMs = typeof parsed.pausedMs === "number" ? parsed.pausedMs : null;
    if (endsAt == null && pausedMs == null) return null;
    if (endsAt != null && now - endsAt > SESSION_MAX_AGE_MS) return null;
    return {
      exerciseId: parsed.exerciseId,
      exerciseName: parsed.exerciseName,
      durationSec: clampRestSeconds(parsed.durationSec),
      endsAt,
      pausedMs,
    };
  } catch {
    return null;
  }
}
