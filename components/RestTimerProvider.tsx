"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import RestTimerBar, {
  useRestTimer,
  type RestTimerController,
} from "@/components/RestTimerBar";

/**
 * 休憩タイマーをアプリ全体で 1 つだけ動かすための入れ物。
 *
 * 以前はタイマーを「記録」ページの中に置いていたため、食事・からだ・
 * カレンダーなど別のタブに移った瞬間にタイマーごと消えていた
 * (画面を離れると音も鳴らなかった)。
 *
 * AppShell(全ページ共通の枠)に置くことで、タブを移動しても休憩は
 * 続き、バーも出したまま、時間になれば必ず鳴る。
 */

type RestTimerContextValue = RestTimerController & {
  /**
   * タイマーのバーを一段上げるかどうかを設定する。
   * 記録ページの一括削除バーなど、下に別の固定要素が出るときに使う。
   */
  setRaised: (raised: boolean) => void;
};

const RestTimerContext = createContext<RestTimerContextValue | null>(null);

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const timer = useRestTimer();
  const [raised, setRaised] = useState(false);

  const value = useMemo<RestTimerContextValue>(
    () => ({ ...timer, setRaised }),
    [timer]
  );

  return (
    <RestTimerContext.Provider value={value}>
      {/*
        休憩中はタイマーのバーが画面下に固定で出るので、そのぶん余白を足して
        ページのいちばん下の要素が隠れないようにする。
        全ページ共通でここに置く(ページごとに書くと足し忘れる)。
      */}
      <div className={timer.session ? "pb-52" : ""}>{children}</div>
      <RestTimerBar timer={timer} raised={raised} />
    </RestTimerContext.Provider>
  );
}

/**
 * 休憩タイマーの操作。
 * ログインしていない画面(ログイン画面など)ではタイマー自体が無いので、
 * 何もしない安全な値を返す。
 */
export function useRestTimerContext(): RestTimerContextValue {
  const value = useContext(RestTimerContext);
  const noop = useCallback(() => {}, []);
  if (value) return value;
  return {
    session: null,
    leftMs: 0,
    running: false,
    settings: { sound: false, autoStart: false, lockScreen: false },
    secondsForExercise: () => 0,
    start: noop,
    prepareAudio: noop,
    stop: noop,
    pause: noop,
    resume: noop,
    addSeconds: noop,
    changeDuration: noop,
    restart: noop,
    updateSettings: noop,
    setRaised: noop,
  };
}
