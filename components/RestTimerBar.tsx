"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Timer,
  X,
} from "lucide-react";
import {
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_PRESETS,
  type RestSession,
  type RestSettings,
  clampRestSeconds,
  formatCountdown,
  formatDuration,
  loadRestSecondsMap,
  loadRestSettings,
  loadSession,
  restSecondsFor,
  saveRestSecondsFor,
  saveRestSettings,
  saveSession,
} from "@/lib/restTimer";
import { MAX_SCHEDULED_SECONDS } from "@/lib/restAlarm";
import {
  canScheduleAlarm,
  isAudioSupported,
  isScheduledAlarmActive,
  playBeep,
  resumeAudio,
  startScheduledAlarm,
  stopScheduledAlarm,
  unlockAudio,
  vibrate,
} from "@/lib/restSound";

/** 表示を更新する間隔。秒表示なので細かすぎなくてよい。 */
const TICK_MS = 200;

export type RestTimerController = ReturnType<typeof useRestTimer>;

/**
 * セット間の休憩タイマー。
 *
 * 残り時間は「終了予定時刻 − 現在時刻」で毎回計算する。
 * iOS では画面を消したりアプリを裏に回すと setInterval が止まってしまうため、
 * 経過を積み上げる方式にすると時間がずれる。絶対時刻で持てば、
 * 戻ってきた瞬間に正しい残り時間になる。
 */
export function useRestTimer() {
  const [session, setSession] = useState<RestSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // これらは休憩バーを出しているときだけ使う値なので、初期値として読んでも
  // サーバー描画の HTML とは食い違わない(未設定・サーバー上では既定値が返る)
  const [secondsMap, setSecondsMap] =
    useState<Record<string, number>>(loadRestSecondsMap);
  const [settings, setSettings] = useState<RestSettings>(loadRestSettings);
  const tickedSecondRef = useRef<number | null>(null);
  /** この休憩の終了音をもう鳴らしたか(interval から読むので ref で持つ) */
  const firedRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 画面を移動して戻ってきたときなどに、続いている休憩を復元する。
  // sessionStorage はサーバー描画では読めないため初期値にはできない。
  useEffect(() => {
    const restored = loadSession(Date.now());
    if (!restored) return;
    // 戻ってきた時点で既に終わっていたものは、鳴らし直さない
    if (restored.endsAt != null && restored.endsAt <= Date.now()) {
      firedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 保存された休憩の復元はマウント後にしかできない
    setSession(restored);
  }, []);

  // 最初のタップで音を出せる状態にしておく(iOS は操作なしでは鳴らせない)
  useEffect(() => {
    const onFirstTap = () => unlockAudio();
    window.addEventListener("pointerdown", onFirstTap, { once: true });
    return () => window.removeEventListener("pointerdown", onFirstTap);
  }, []);

  const running = session != null && session.endsAt != null;
  const endsAt = session?.endsAt ?? null;
  const soundOn = settings.sound;

  /**
   * 動作中の計時。表示の更新と、予告音・終了音をここでまとめて行う。
   *
   * 裏に回っている間 setInterval は止まるが、戻ってきた瞬間の 1 回目で
   * 「残り <= 0」を検出して鳴らすので、休憩が終わったことには必ず気づける。
   */
  useEffect(() => {
    if (endsAt == null) return;
    const onTick = () => {
      const t = Date.now();
      setNow(t);
      const left = endsAt - t;
      // 予約再生(画面ロック対応)が動いているときは、音声側が予定どおり
      // 鳴らしてくれるので、ここで重ねて鳴らさない
      const scheduled = isScheduledAlarmActive();
      if (left <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          if (soundOn && !scheduled) playBeep("finish");
          vibrate([200, 100, 200, 100, 400]);
        }
        return;
      }
      const secondsLeft = Math.ceil(left / 1000);
      if (secondsLeft <= 3 && tickedSecondRef.current !== secondsLeft) {
        tickedSecondRef.current = secondsLeft;
        if (soundOn && !scheduled) playBeep("tick");
      }
    };
    onTick();
    const id = window.setInterval(onTick, TICK_MS);
    return () => window.clearInterval(id);
  }, [endsAt, soundOn]);

  /** 休憩中は画面を消さない(消えると音が鳴らないため)。対応端末のみ。 */
  const requestWakeLock = useCallback(async () => {
    try {
      if (!("wakeLock" in navigator) || wakeLockRef.current) return;
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // 取得できなくてもタイマーは動く
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    try {
      void sentinel?.release();
    } catch {
      // すでに解放済みなら何もしない
    }
  }, []);

  useEffect(() => {
    if (running) void requestWakeLock();
    else releaseWakeLock();
  }, [running, requestWakeLock, releaseWakeLock]);

  useEffect(() => releaseWakeLock, [releaseWakeLock]);

  // 画面に戻ってきたら、時計と音と画面ロックを立て直す
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      resumeAudio();
      if (running) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running, requestWakeLock]);

  const leftMs =
    session == null
      ? 0
      : session.endsAt != null
        ? session.endsAt - now
        : (session.pausedMs ?? 0);

  const persist = useCallback((next: RestSession | null) => {
    setSession(next);
    saveSession(next);
  }, []);

  /**
   * 画面ロック中でも鳴らすための予約再生を仕掛け直す。
   *
   * **必ずタップ操作の中から呼ぶこと。** 操作なしの再生は端末に拒否される。
   * 条件を満たさない場合(音オフ / 設定オフ / 長すぎる休憩)は止めるだけで、
   * その場合は従来どおり画面が点いているあいだに鳴らす方式で動く。
   */
  const armAlarm = useCallback(
    (remainingSeconds: number, exerciseName: string) => {
      if (!settings.sound || !settings.lockScreen) {
        stopScheduledAlarm();
        return;
      }
      startScheduledAlarm(remainingSeconds, exerciseName);
    },
    [settings.sound, settings.lockScreen]
  );

  /** 画面から離れるときは音声を止めて後片付けする */
  useEffect(() => stopScheduledAlarm, []);

  /** その種目に覚えさせてある休憩時間 */
  const secondsForExercise = useCallback(
    (exerciseId: string | null) => restSecondsFor(secondsMap, exerciseId),
    [secondsMap]
  );

  /** 休憩を開始する。必ずタップ操作の中から呼ぶこと(音の許可のため) */
  const start = useCallback(
    (exerciseId: string, exerciseName: string, seconds?: number) => {
      unlockAudio();
      const durationSec = clampRestSeconds(
        seconds ?? restSecondsFor(secondsMap, exerciseId)
      );
      tickedSecondRef.current = null;
      firedRef.current = false;
      setNow(Date.now());
      persist({
        exerciseId,
        exerciseName,
        durationSec,
        endsAt: Date.now() + durationSec * 1000,
        pausedMs: null,
      });
      armAlarm(durationSec, exerciseName);
    },
    [secondsMap, persist, armAlarm]
  );

  /** フォーム送信のように非同期処理をはさむ場合、先に呼んで音の許可だけ取っておく */
  const prepareAudio = useCallback(() => {
    unlockAudio();
  }, []);

  const stop = useCallback(() => {
    tickedSecondRef.current = null;
    firedRef.current = false;
    stopScheduledAlarm();
    persist(null);
  }, [persist]);

  const pause = useCallback(() => {
    if (!session || session.endsAt == null) return;
    stopScheduledAlarm();
    persist({
      ...session,
      endsAt: null,
      pausedMs: Math.max(0, session.endsAt - Date.now()),
    });
  }, [session, persist]);

  const resume = useCallback(() => {
    unlockAudio();
    if (!session || session.endsAt != null) return;
    const remainingMs = session.pausedMs ?? 0;
    persist({
      ...session,
      endsAt: Date.now() + remainingMs,
      pausedMs: null,
    });
    setNow(Date.now());
    armAlarm(remainingMs / 1000, session.exerciseName);
  }, [session, persist, armAlarm]);

  /** 「+30秒」など。終了後に押したときは、そこから測り直す。 */
  const addSeconds = useCallback(
    (delta: number) => {
      unlockAudio();
      if (!session) return;
      let next: RestSession;
      if (session.endsAt == null) {
        // 一時停止中は残り時間そのものを増やす
        next = {
          ...session,
          pausedMs: Math.max(0, (session.pausedMs ?? 0) + delta * 1000),
        };
      } else {
        // 終了後に押したときは、そこから測り直す
        const base = Math.max(Date.now(), session.endsAt);
        next = { ...session, endsAt: base + delta * 1000 };
      }
      persist(next);
      tickedSecondRef.current = null;
      firedRef.current = false;
      setNow(Date.now());
      if (next.endsAt != null) {
        armAlarm((next.endsAt - Date.now()) / 1000, next.exerciseName);
      } else {
        stopScheduledAlarm();
      }
    },
    [session, persist, armAlarm]
  );

  /** この種目の休憩時間を変更して、次回以降も同じ長さで始める */
  const changeDuration = useCallback(
    (seconds: number) => {
      unlockAudio();
      const durationSec = clampRestSeconds(seconds);
      setSecondsMap((prev) => {
        const current = session;
        if (!current) return prev;
        return saveRestSecondsFor(prev, current.exerciseId, durationSec);
      });
      if (!session) return;
      const next: RestSession = {
        ...session,
        durationSec,
        endsAt: session.endsAt != null ? Date.now() + durationSec * 1000 : null,
        pausedMs: session.endsAt != null ? null : durationSec * 1000,
      };
      persist(next);
      tickedSecondRef.current = null;
      firedRef.current = false;
      setNow(Date.now());
      if (next.endsAt != null) {
        armAlarm(durationSec, next.exerciseName);
      } else {
        stopScheduledAlarm();
      }
    },
    [session, persist, armAlarm]
  );

  /** 同じ長さでもう一度 */
  const restart = useCallback(() => {
    if (!session) return;
    start(session.exerciseId, session.exerciseName, session.durationSec);
  }, [session, start]);

  const updateSettings = useCallback(
    (patch: Partial<RestSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      saveRestSettings(next);

      // 設定を切り替えたタップの中でなら、予約再生を仕掛け直せる
      // (あとから仕掛けようとしても、操作なしの再生は端末に拒否される)
      if (session?.endsAt != null && next.sound && next.lockScreen) {
        startScheduledAlarm(
          (session.endsAt - Date.now()) / 1000,
          session.exerciseName
        );
      } else {
        stopScheduledAlarm();
      }
    },
    [settings, session]
  );

  return {
    session,
    leftMs,
    running,
    settings,
    secondsForExercise,
    start,
    prepareAudio,
    stop,
    pause,
    resume,
    addSeconds,
    changeDuration,
    restart,
    updateSettings,
  };
}

/** 秒数を「1分30秒」のように読める形にする(ボタンのラベル用) */
function presetLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}分` : `${m}分${s}秒`;
}

/**
 * 画面下部に固定して出す休憩タイマー。
 * トレーニング中は片手で操作するので、ボタンは大きめ・間隔広めにしている。
 */
export default function RestTimerBar({
  timer,
  /** 削除バーなどが下に出ているときは、重ならないよう一段上げる */
  raised = false,
}: {
  timer: RestTimerController;
  raised?: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { session, leftMs, running, settings } = timer;

  if (!session) return null;

  const overdue = leftMs <= 0;
  // 休憩が終わったら設定パネルは隠して、次の操作をしやすくする
  const openSettings = settingsOpen && !overdue;

  // 残りは切り上げ(1:30 から始まる)、超過は切り捨て(+0:00 から増える)
  const shownTime = overdue
    ? formatDuration(Math.abs(leftMs) / 1000)
    : formatCountdown(leftMs);
  const progress = Math.min(
    100,
    Math.max(0, (leftMs / (session.durationSec * 1000)) * 100)
  );

  return (
    <div
      role="timer"
      aria-label="休憩タイマー"
      className={`fixed inset-x-0 z-40 mx-auto w-full max-w-md px-4 ${
        raised
          ? "bottom-[calc(env(safe-area-inset-bottom)+8rem)]"
          : "bottom-[calc(env(safe-area-inset-bottom)+3.5rem)]"
      }`}
    >
      <div
        className={`rounded-2xl p-3 text-white shadow-lg ${
          overdue ? "bg-emerald-600" : "bg-gray-900"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-xs text-white/70">
              <Timer aria-hidden size={12} />
              <span className="truncate">{session.exerciseName}</span>
            </p>
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                {overdue ? "+" : ""}
                {shownTime}
              </span>
              <span className="text-xs font-semibold">
                {overdue
                  ? "休憩終了(経過)"
                  : running
                    ? `${presetLabel(session.durationSec)}の休憩`
                    : "一時停止中"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="休憩時間の設定"
            aria-expanded={openSettings}
            className="shrink-0 rounded-lg bg-white/15 p-2.5 active:bg-white/25"
          >
            <Settings2 aria-hidden size={18} />
          </button>
          <button
            type="button"
            onClick={timer.stop}
            aria-label="休憩タイマーを閉じる"
            className="shrink-0 rounded-lg bg-white/15 p-2.5 active:bg-white/25"
          >
            <X aria-hidden size={18} />
          </button>
        </div>

        {/* 残りを一目で見るためのバー */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-200 ease-linear"
            style={{ width: `${overdue ? 100 : progress}%` }}
          />
        </div>

        <div className="mt-2.5 flex gap-2">
          {overdue ? (
            <button
              type="button"
              onClick={timer.restart}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-3 text-sm font-semibold text-emerald-700 active:opacity-80"
            >
              <RotateCcw aria-hidden size={16} />
              もう一度
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => timer.addSeconds(30)}
                className="flex-1 rounded-xl bg-white/15 py-3 text-sm font-semibold active:bg-white/25"
              >
                +30秒
              </button>
              <button
                type="button"
                onClick={running ? timer.pause : timer.resume}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/15 py-3 text-sm font-semibold active:bg-white/25"
              >
                {running ? (
                  <>
                    <Pause aria-hidden size={16} />
                    一時停止
                  </>
                ) : (
                  <>
                    <Play aria-hidden size={16} />
                    再開
                  </>
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => timer.updateSettings({ sound: !settings.sound })}
            aria-label={settings.sound ? "通知音をオフにする" : "通知音をオンにする"}
            aria-pressed={settings.sound}
            className="shrink-0 rounded-xl bg-white/15 px-4 active:bg-white/25"
          >
            {settings.sound ? (
              <Bell aria-hidden size={18} />
            ) : (
              <BellOff aria-hidden size={18} className="text-white/50" />
            )}
          </button>
        </div>

        {openSettings && (
          <div className="mt-3 border-t border-white/20 pt-3">
            <p className="mb-1.5 text-xs text-white/70">
              「{session.exerciseName}」の休憩時間(次回からも使われます)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REST_PRESETS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => timer.changeDuration(sec)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                    session.durationSec === sec
                      ? "bg-white text-gray-900"
                      : "bg-white/15 active:bg-white/25"
                  }`}
                >
                  {presetLabel(sec)}
                </button>
              ))}
            </div>

            <label className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span>秒数を指定</span>
              <input
                // プリセットで変えたときに表示も追従させたいので、
                // 値が変わったら作り直す(入力中に書き換わらないよう defaultValue のまま)
                key={session.durationSec}
                type="number"
                inputMode="numeric"
                min={MIN_REST_SECONDS}
                max={MAX_REST_SECONDS}
                defaultValue={session.durationSec}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) timer.changeDuration(v);
                }}
                className="w-24 rounded-lg bg-white/15 px-3 py-2 text-right tabular-nums"
              />
            </label>

            <label className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span>記録を追加したら自動で開始</span>
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) =>
                  timer.updateSettings({ autoStart: e.target.checked })
                }
                className="h-5 w-5 accent-emerald-400"
              />
            </label>

            <label className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0">
                画面が消えても鳴らす
                <span className="mt-0.5 block text-[11px] leading-relaxed text-white/60">
                  {settings.lockScreen && !canScheduleAlarm(session.durationSec)
                    ? `${Math.floor(
                        MAX_SCHEDULED_SECONDS / 60
                      )}分より長い休憩では使えません(画面が点いていれば鳴ります)`
                    : "ロック画面にも残り時間が出ます。音楽アプリの再生は止まります"}
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.lockScreen}
                onChange={(e) =>
                  timer.updateSettings({ lockScreen: e.target.checked })
                }
                className="h-5 w-5 shrink-0 accent-emerald-400"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-white/70">
                {isAudioSupported()
                  ? "iPhone は本体の消音スイッチが入っていると鳴りません。音量とあわせて確認してください。"
                  : "この端末では通知音を鳴らせません。"}
              </p>
              <button
                type="button"
                onClick={() => playBeep("finish")}
                className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold active:bg-white/25"
              >
                音を試す
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
