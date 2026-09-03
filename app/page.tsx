"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import SortableList from "@/components/SortableList";
import SetInputList, { nextSet } from "@/components/SetInputList";
import TrendBadges from "@/components/TrendBadges";
import { GripVertical, NotebookPen, StickyNote } from "lucide-react";
import {
  formatDateLabel,
  formatShortDateLabel,
  todayString,
} from "@/lib/date";
import { VIZ } from "@/lib/viz";
import {
  buildPreviousMemoMap,
  buildPreviousRecordMap,
  compareWithPrevious,
  formatWeight,
  hasMemo,
  hasWeight,
  maxWeight,
  memoText,
  sortLogs,
  sortSets,
  totalVolume,
  type PreviousMemo,
  type PreviousRecord,
} from "@/lib/workoutStats";
import { normalizeMuscleGroup } from "@/lib/muscleGroups";
import type {
  Exercise,
  RoutineWithItems,
  SetInput,
  WorkoutLogWithExercise,
  WorkoutSet,
} from "@/lib/types";

const PHASE4_SETUP_HINT = "(supabase/phase4.sql を実行済みか確認してください)";

/** 削除後に「元に戻す」を出しておく時間 */
const UNDO_TIMEOUT_MS = 8000;

/** 確認ダイアログに種目名を並べる上限(多すぎると読めないので省略する) */
const CONFIRM_NAME_LIMIT = 8;

/** メモの最大文字数(短い書き置きを想定) */
const MEMO_MAX_LENGTH = 500;

const MEMO_PLACEHOLDER =
  "例: フォームを意識 / 肘が痛かったので軽め / 次回は+2.5kg";

/**
 * 一括削除の直前の状態。
 * 「元に戻す」で同じ id のまま復元できるよう、セットまで丸ごと持っておく。
 */
type DeletedSnapshot = {
  logs: WorkoutLogWithExercise[];
};

/** DB のセットを入力フォーム用の文字列に変換する */
function toSetInputs(sets: WorkoutSet[]): SetInput[] {
  return sortSets(sets).map((s) => ({
    id: s.id,
    weight_kg: String(Number(s.weight_kg)),
    reps: String(Number(s.reps)),
  }));
}

/** 入力値を保存できる形(数値)に変換する。空欄は 0 扱い */
function toSetRows(sets: SetInput[]) {
  return sets.map((s, index) => ({
    set_number: index + 1,
    weight_kg: Number(s.weight_kg) || 0,
    reps: Number(s.reps) || 0,
  }));
}

function exerciseName(log: WorkoutLogWithExercise): string {
  return log.exercises?.name ?? "(削除された種目)";
}

/** 部位バッジ + 種目名(通常表示と選択モードで共通に使う) */
function ExerciseHeading({ log }: { log: WorkoutLogWithExercise }) {
  return (
    <>
      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
        {normalizeMuscleGroup(
          log.exercises?.muscle_group,
          log.exercises?.name ?? undefined
        )}
      </span>
      <p className="min-w-0 truncate font-semibold">{exerciseName(log)}</p>
    </>
  );
}

/**
 * メモの表示(メモのアイコン + 本文)。
 * 一覧が窮屈にならないよう 2 行までに抑え、続きは編集画面で読む。
 * ボタンの中にも置くので、要素は span だけで組む。
 */
function MemoLine({ memo }: { memo: string }) {
  return (
    <span className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-left text-xs leading-relaxed text-amber-900">
      <StickyNote aria-hidden size={14} className="mt-0.5 shrink-0" />
      <span className="line-clamp-2 min-w-0 flex-1 break-words whitespace-pre-wrap">
        {memo}
      </span>
    </span>
  );
}

/** セットの一覧(「1set 80kg × 10回」)。通常表示と選択モードで共通に使う */
function SetLines({ sets }: { sets: WorkoutSet[] }) {
  if (sets.length === 0) {
    return <p className="mt-1 text-sm text-gray-400">セットが未入力です</p>;
  }
  return (
    <ul className="mt-1 space-y-0.5">
      {sets.map((s, i) => (
        <li key={s.id} className="flex items-baseline gap-2 text-sm">
          <span
            className="w-9 shrink-0 text-xs tabular-nums"
            style={{ color: VIZ.muted }}
          >
            {i + 1}set
          </span>
          <span className="tabular-nums text-gray-700">
            {Number(s.weight_kg) > 0 ? (
              <>{formatWeight(Number(s.weight_kg))}kg × </>
            ) : (
              <span className="text-gray-400">重量なし × </span>
            )}
            {Number(s.reps)}回
          </span>
        </li>
      ))}
    </ul>
  );
}

function RecordPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(
    () => searchParams.get("date") ?? todayString()
  );
  const [logs, setLogs] = useState<WorkoutLogWithExercise[]>([]);
  const [previous, setPrevious] = useState<Map<string, PreviousRecord>>(
    new Map()
  );
  /** 種目ごとの「前回のメモ」(その日より前で、いちばん新しいメモ) */
  const [previousMemos, setPreviousMemos] = useState<Map<string, PreviousMemo>>(
    new Map()
  );
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<RoutineWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [exerciseId, setExerciseId] = useState("");
  const [newSets, setNewSets] = useState<SetInput[]>([
    { id: null, weight_kg: "", reps: "10" },
  ]);
  const [saving, setSaving] = useState(false);

  // 編集(記録 1 件分のセットをまとめて編集する)
  const [editId, setEditId] = useState<string | null>(null);
  const [editSets, setEditSets] = useState<SetInput[]>([]);

  // メモ編集(日付 × 種目 = 記録 1 件につき 1 つ)
  const [memoEditId, setMemoEditId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);

  // ルーティン展開
  const [routineId, setRoutineId] = useState("");
  const [applying, setApplying] = useState(false);

  // 選択モード(種目の一括削除)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [undoTarget, setUndoTarget] = useState<DeletedSnapshot | null>(null);

  /**
   * 「この日の種目をすべて削除」の案内を出すかどうか。
   *
   * 本来はルーティンを間違えて展開した直後に使うものなので、常時出さずに
   * 展開した直後だけ出す。× で閉じる・日付を変える・画面に入り直すと消える。
   * (閉じたあとは「選択して削除」→「すべて選択」で同じことができる)
   */
  const [justExpanded, setJustExpanded] = useState(false);

  /** その日の記録と、同じ種目の「前回の記録」をまとめて取得する */
  const loadLogs = useCallback(async (targetDate: string) => {
    const supabase = createClient();
    const { data, error: logError } = await supabase
      .from("workout_logs")
      .select("*, exercises(id, name, muscle_group), workout_sets(*)")
      .eq("workout_date", targetDate)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (logError) {
      setError(`記録の取得に失敗しました: ${logError.message}${PHASE4_SETUP_HINT}`);
      return;
    }
    const dayLogs = sortLogs((data as WorkoutLogWithExercise[]) ?? []);
    setLogs(dayLogs);
    setError(null);

    // 消えた記録を選択したままにしない
    const aliveIds = new Set(dayLogs.map((l) => l.id));
    setSelectedIds((ids) => ids.filter((id) => aliveIds.has(id)));

    const exerciseIds = [...new Set(dayLogs.map((l) => l.exercise_id))];
    if (exerciseIds.length === 0) {
      setPrevious(new Map());
      setPreviousMemos(new Map());
      return;
    }

    // その日より前の記録を新しい順に取り、種目ごとに最初の 1 件を「前回」とする
    // (メモも同じ問い合わせで拾って「前回のメモ」として出す)
    const { data: prevData } = await supabase
      .from("workout_logs")
      .select(
        "exercise_id, workout_date, memo, workout_sets(weight_kg, reps, set_number)"
      )
      .in("exercise_id", exerciseIds)
      .lt("workout_date", targetDate)
      .order("workout_date", { ascending: false })
      .limit(200);

    const prevRows =
      (prevData as
        | {
            exercise_id: string;
            workout_date: string;
            memo: string | null;
            workout_sets: WorkoutSet[] | null;
          }[]
        | null) ?? [];

    setPrevious(buildPreviousRecordMap(prevRows));
    setPreviousMemos(buildPreviousMemoMap(prevRows));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      setLoading(true);
      const [exRes, rtRes] = await Promise.all([
        supabase.from("exercises").select("*").order("name"),
        supabase
          .from("routines")
          .select("*, routine_items(*, exercises(id, name, muscle_group))")
          .order("name"),
      ]);
      if (!exRes.error) setExercises(exRes.data ?? []);
      if (!rtRes.error) setRoutines((rtRes.data as RoutineWithItems[]) ?? []);
      await loadLogs(date);
      setLoading(false);
    })();
    // date 変更時は下の useEffect で再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setEditId(null);
      setMemoEditId(null);
      setMemoDraft("");
      // 日付をまたいで選択状態や「元に戻す」を持ち越さない
      setSelectMode(false);
      setSelectedIds([]);
      setUndoTarget(null);
      setJustExpanded(false);
      await loadLogs(date);
    })();
  }, [date, loadLogs]);

  // 「元に戻す」は数秒だけ出す(押さなければそのまま消える)
  useEffect(() => {
    if (!undoTarget) return;
    const timer = setTimeout(() => setUndoTarget(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [undoTarget]);

  const addLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exerciseId) return;
    if (newSets.length === 0) {
      setError("セットを 1 つ以上追加してください。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const maxOrder = logs.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data: inserted, error: insertError } = await supabase
      .from("workout_logs")
      .insert({
        user_id: user.id,
        workout_date: date,
        exercise_id: exerciseId,
        sort_order: maxOrder + 1,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      setError(
        `保存に失敗しました: ${insertError?.message ?? "不明なエラー"}${PHASE4_SETUP_HINT}`
      );
      setSaving(false);
      return;
    }

    const { error: setsError } = await supabase.from("workout_sets").insert(
      toSetRows(newSets).map((row) => ({
        workout_log_id: inserted.id as string,
        ...row,
      }))
    );
    if (setsError) {
      setError(`セットの保存に失敗しました: ${setsError.message}`);
    } else {
      // 次の種目もだいたい同じセット構成なので、直前の入力を残しておく
      setExerciseId("");
    }
    await loadLogs(date);
    setSaving(false);
  };

  const startEdit = (log: WorkoutLogWithExercise) => {
    setMemoEditId(null);
    setEditId(log.id);
    const inputs = toSetInputs(log.workout_sets ?? []);
    setEditSets(inputs.length > 0 ? inputs : [nextSet([])]);
  };

  const saveEdit = async () => {
    if (!editId) return;
    if (editSets.length === 0) {
      setError("セットを 1 つ以上残してください(記録ごと消す場合は削除ボタンから)。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    // set_number を振り直すので、いったん全部消してから入れ直す
    const { error: delError } = await supabase
      .from("workout_sets")
      .delete()
      .eq("workout_log_id", editId);
    if (delError) {
      setError(`更新に失敗しました: ${delError.message}`);
      setSaving(false);
      return;
    }
    const { error: insError } = await supabase.from("workout_sets").insert(
      toSetRows(editSets).map((row) => ({ workout_log_id: editId, ...row }))
    );
    if (insError) {
      setError(`更新に失敗しました: ${insError.message}`);
    } else {
      setEditId(null);
    }
    await loadLogs(date);
    setSaving(false);
  };

  /** メモの編集を開く(セットの編集とは同時に開かない) */
  const startMemoEdit = (log: WorkoutLogWithExercise) => {
    setEditId(null);
    setMemoEditId(log.id);
    setMemoDraft(memoText(log.memo));
  };

  const cancelMemoEdit = () => {
    setMemoEditId(null);
    setMemoDraft("");
  };

  /**
   * メモを保存する(空にして保存すればメモを消せる)。
   * メモは「日付 × 種目」= workout_logs 1 行に紐づくので、その行を更新するだけ。
   */
  const saveMemo = async (log: WorkoutLogWithExercise, memo: string) => {
    const trimmed = memo.trim().slice(0, MEMO_MAX_LENGTH);
    setMemoSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: memoError } = await supabase
      .from("workout_logs")
      .update({ memo: trimmed === "" ? null : trimmed })
      .eq("id", log.id);

    if (memoError) {
      setError(`メモの保存に失敗しました: ${memoError.message}`);
    } else {
      setMemoEditId(null);
      setMemoDraft("");
    }
    await loadLogs(date);
    setMemoSaving(false);
  };

  const deleteMemo = (log: WorkoutLogWithExercise) => {
    if (memoSaving) return;
    const ok = confirm(`${exerciseName(log)}のメモを削除します。よろしいですか?`);
    if (!ok) return;
    void saveMemo(log, "");
  };

  /**
   * 種目(workout_logs)をまとめて削除する。
   *
   * DB 側の外部キーは workout_sets.workout_log_id → workout_logs.id が
   * on delete cascade なので親を消せばセットも消えるが、
   * 環境によって古いスキーマのまま(cascade 未設定)の可能性があるため、
   * 孤児レコードを残さないよう
   * 「先に workout_sets → 次に workout_logs」の順でアプリ側からも明示的に消す。
   * cascade 済みの環境でも、先に子を消してあるだけなので二重に消えて困ることはない。
   */
  const deleteLogs = async (targets: WorkoutLogWithExercise[]) => {
    if (targets.length === 0) return;
    const ids = targets.map((l) => l.id);

    setDeleting(true);
    setError(null);
    const supabase = createClient();

    const { error: setsError } = await supabase
      .from("workout_sets")
      .delete()
      .in("workout_log_id", ids);
    if (setsError) {
      setError(`セットの削除に失敗しました: ${setsError.message}`);
      setDeleting(false);
      return;
    }

    const { error: logsError } = await supabase
      .from("workout_logs")
      .delete()
      .in("id", ids);
    if (logsError) {
      setError(`削除に失敗しました: ${logsError.message}`);
      await loadLogs(date);
      setDeleting(false);
      return;
    }

    setSelectedIds([]);
    setSelectMode(false);
    setUndoTarget({ logs: targets });
    setJustExpanded(false);
    await loadLogs(date);
    setDeleting(false);
  };

  /** 件数と種目名を見せてから削除する(取り返しがつかないので必ず通す) */
  const confirmAndDelete = (targets: WorkoutLogWithExercise[]) => {
    if (targets.length === 0 || deleting) return;
    const shown = targets
      .slice(0, CONFIRM_NAME_LIMIT)
      .map((l) => `・${exerciseName(l)}`)
      .join("\n");
    const rest =
      targets.length > CONFIRM_NAME_LIMIT
        ? `\n・ほか${targets.length - CONFIRM_NAME_LIMIT}件`
        : "";
    const ok = confirm(
      `${targets.length}件の種目を削除します。よろしいですか?\n\n` +
        `${shown}${rest}\n\n` +
        "各種目のセットの記録もいっしょに削除されます。"
    );
    if (!ok) return;
    void deleteLogs(targets);
  };

  const deleteLog = (log: WorkoutLogWithExercise) => confirmAndDelete([log]);

  const deleteSelected = () =>
    confirmAndDelete(logs.filter((l) => selectedIds.includes(l.id)));

  const deleteAllOfDay = () => confirmAndDelete(logs);

  /**
   * 直前の一括削除を元に戻す。
   *
   * workout_sets の RLS / 外部キーは親の workout_logs が居ることを前提にしているので、
   * 削除とは逆に「先に workout_logs → 次に workout_sets」の順で戻す。
   * id をそのまま指定して入れ直すので、並び順もセットの内容も削除前と同じになる。
   */
  const undoDelete = async () => {
    const snapshot = undoTarget;
    if (!snapshot || deleting) return;

    setDeleting(true);
    setError(null);
    const supabase = createClient();

    const { error: logsError } = await supabase.from("workout_logs").insert(
      snapshot.logs.map((l) => ({
        id: l.id,
        user_id: l.user_id,
        workout_date: l.workout_date,
        exercise_id: l.exercise_id,
        memo: l.memo,
        sort_order: l.sort_order,
        created_at: l.created_at,
      }))
    );
    if (logsError) {
      setError(`元に戻せませんでした: ${logsError.message}`);
      await loadLogs(date);
      setDeleting(false);
      return;
    }

    const setRows = snapshot.logs.flatMap((l) =>
      (l.workout_sets ?? []).map((s) => ({
        id: s.id,
        workout_log_id: l.id,
        set_number: s.set_number,
        weight_kg: s.weight_kg,
        reps: s.reps,
        created_at: s.created_at,
      }))
    );
    if (setRows.length > 0) {
      const { error: setsError } = await supabase
        .from("workout_sets")
        .insert(setRows);
      if (setsError) {
        setError(`セットを元に戻せませんでした: ${setsError.message}`);
      }
    }

    setUndoTarget(null);
    await loadLogs(date);
    setDeleting(false);
  };

  /** 選択モードに入る / 抜ける。抜けるときはチェックをすべて解除する */
  const toggleSelectMode = () => {
    setSelectMode((on) => {
      if (on) setSelectedIds([]);
      return !on;
    });
    setEditId(null);
    setMemoEditId(null);
  };

  /** 選択をすべて破棄して通常モードに戻る(キャンセル) */
  const exitSelectMode = () => {
    setSelectedIds([]);
    setSelectMode(false);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
    );
  };

  const allSelected = logs.length > 0 && selectedIds.length === logs.length;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : logs.map((l) => l.id));
  };

  /** ドラッグ&ドロップの結果を sort_order として保存する */
  const reorderLogs = async (next: WorkoutLogWithExercise[]) => {
    const renumbered = next.map((log, index) => ({
      ...log,
      sort_order: index + 1,
    }));
    setLogs(renumbered); // 先に画面を動かして、待たせない
    const supabase = createClient();
    const results = await Promise.all(
      renumbered.map((log) =>
        supabase
          .from("workout_logs")
          .update({ sort_order: log.sort_order })
          .eq("id", log.id)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(`並び順の保存に失敗しました: ${failed.error.message}`);
      await loadLogs(date);
    }
  };

  /**
   * ルーティンをその日の記録に展開する。
   *
   * 展開したセットの重量は次の優先順位で決める。
   * 1. ルーティンに設定した目標重量
   * 2. その種目の直近の記録(前回と同じ重量から始めることが多いため)
   * 3. どちらも無ければ 0kg(= 重量未入力。画面では「重量なし」と表示する)
   *
   * 以前は 1 が未設定だと無条件に 0kg のセットを作っていたため、
   * 記録が「3セット・最大 0kg」のまま残ってしまっていた。
   */
  const applyRoutine = async () => {
    const routine = routines.find((r) => r.id === routineId);
    if (!routine || routine.routine_items.length === 0) return;
    setApplying(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setApplying(false);
      return;
    }

    let items = [...routine.routine_items].sort(
      (a, b) => a.sort_order - b.sort_order
    );

    // すでにその日に記録がある種目は、うっかり二重に展開しないよう確認する
    const recordedIds = new Set(logs.map((l) => l.exercise_id));
    const duplicated = items.filter((item) => recordedIds.has(item.exercise_id));
    if (duplicated.length > 0) {
      const names = duplicated
        .map((item) => item.exercises?.name ?? "(削除された種目)")
        .join("・");
      const addAnyway = confirm(
        `${names} はすでにこの日に記録があります。\n\n` +
          "OK: そのまま重複して追加する\n" +
          "キャンセル: まだ記録がない種目だけを追加する"
      );
      if (!addAnyway) {
        items = items.filter((item) => !recordedIds.has(item.exercise_id));
      }
    }
    if (items.length === 0) {
      setRoutineId("");
      setApplying(false);
      return;
    }

    // 目標重量が未設定の種目のために、直近の記録を引いておく
    const missingWeightIds = [
      ...new Set(
        items
          .filter((item) => item.default_weight_kg == null)
          .map((item) => item.exercise_id)
      ),
    ];
    let previousByExercise = new Map<string, PreviousRecord>();
    if (missingWeightIds.length > 0) {
      const { data: prevData } = await supabase
        .from("workout_logs")
        .select("exercise_id, workout_date, workout_sets(weight_kg, reps, set_number)")
        .in("exercise_id", missingWeightIds)
        .lt("workout_date", date)
        .order("workout_date", { ascending: false })
        .limit(200);
      previousByExercise = buildPreviousRecordMap(
        (prevData as
          | {
              exercise_id: string;
              workout_date: string;
              workout_sets: WorkoutSet[] | null;
            }[]
          | null) ?? []
      );
    }

    const maxOrder = logs.reduce((m, l) => Math.max(m, l.sort_order), 0);

    const { data: inserted, error: insertError } = await supabase
      .from("workout_logs")
      .insert(
        items.map((item, index) => ({
          user_id: user.id,
          workout_date: date,
          exercise_id: item.exercise_id,
          sort_order: maxOrder + index + 1,
        }))
      )
      .select("id, exercise_id, sort_order");

    if (insertError || !inserted) {
      setError(
        `ルーティンの展開に失敗しました: ${insertError?.message ?? "不明なエラー"}${PHASE4_SETUP_HINT}`
      );
      setApplying(false);
      return;
    }

    // ルーティンの初期値(目標セット数・重量・回数)をセットに展開する
    const insertedRows = inserted as {
      id: string;
      exercise_id: string;
      sort_order: number;
    }[];
    const sorted = [...insertedRows].sort((a, b) => a.sort_order - b.sort_order);
    const setRows = sorted.flatMap((row, index) => {
      const item = items[index];
      const count = Math.max(item?.default_sets ?? 1, 1);

      if (item?.default_weight_kg != null) {
        return Array.from({ length: count }, (_, i) => ({
          workout_log_id: row.id,
          set_number: i + 1,
          weight_kg: Number(item.default_weight_kg) || 0,
          reps: item.default_reps ?? 0,
        }));
      }

      // 目標重量が未設定なら、その種目の前回の記録をそのまま初期値にする
      const previous = previousByExercise.get(row.exercise_id);
      if (previous && previous.sets.length > 0) {
        const prevSets = sortSets(
          previous.sets as { set_number: number; weight_kg: number; reps: number }[]
        );
        return Array.from({ length: Math.max(count, prevSets.length) }, (_, i) => {
          const source = prevSets[i] ?? prevSets[prevSets.length - 1];
          return {
            workout_log_id: row.id,
            set_number: i + 1,
            weight_kg: Number(source.weight_kg) || 0,
            reps: Number(source.reps) || item?.default_reps || 0,
          };
        });
      }

      return Array.from({ length: count }, (_, i) => ({
        workout_log_id: row.id,
        set_number: i + 1,
        weight_kg: 0,
        reps: item?.default_reps ?? 0,
      }));
    });

    const { error: setInsertError } = await supabase
      .from("workout_sets")
      .insert(setRows);
    if (setInsertError) {
      setError(`セットの展開に失敗しました: ${setInsertError.message}`);
    } else {
      setRoutineId("");
      // 展開直後だけ「まとめて削除」の案内を出す
      setJustExpanded(true);
    }
    await loadLogs(date);
    setApplying(false);
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
  };

  return (
    <main className="p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <NotebookPen aria-hidden size={20} strokeWidth={2} />
          ワークアウト記録
        </h1>
        <button
          onClick={signOut}
          className="rounded-lg px-2 py-1 text-xs text-gray-500 active:bg-gray-200"
        >
          ログアウト
        </button>
      </header>

      {/* 日付選択 */}
      <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-semibold text-gray-500">
            日付
          </label>
          <Link
            href={`/calendar?date=${date}`}
            className="text-xs font-semibold text-blue-600"
          >
            カレンダーで選ぶ ›
          </Link>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-gray-500">{formatDateLabel(date)}</p>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* ルーティン展開 */}
      {routines.length > 0 && (
        <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">
          <label className="mb-1 block text-xs font-semibold text-gray-500">
            ルーティンから一括追加
          </label>
          <div className="flex gap-2">
            <select
              value={routineId}
              onChange={(e) => setRoutineId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">選択してください</option>
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}({r.routine_items.length}種目)
                </option>
              ))}
            </select>
            <button
              onClick={applyRoutine}
              disabled={!routineId || applying}
              className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              展開
            </button>
          </div>

          {/*
            間違ったルーティンを展開した直後にすぐ戻せるようにする。
            常時出すと邪魔なので、展開した直後だけ出して × で閉じられるようにする。
          */}
          {justExpanded && logs.length > 0 && (
            <div className="mt-2 flex items-stretch gap-1 rounded-lg border border-red-200 bg-red-50">
              <button
                type="button"
                onClick={deleteAllOfDay}
                disabled={deleting}
                className="min-w-0 flex-1 rounded-l-lg px-3 py-3 text-left text-sm font-semibold text-red-600 active:bg-red-100 disabled:opacity-40"
              >
                間違えて展開した? この日の種目をすべて削除({logs.length}件)
              </button>
              <button
                type="button"
                onClick={() => setJustExpanded(false)}
                aria-label="この案内を閉じる"
                className="flex w-12 shrink-0 items-center justify-center rounded-r-lg text-xl leading-none text-red-400 active:bg-red-100"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* 記録一覧 */}
      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-600">
            この日の記録({logs.length}件)
          </h2>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectMode}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold active:opacity-80 ${
                selectMode
                  ? "bg-gray-200 text-gray-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {selectMode ? "選択をやめる" : "選択して削除"}
            </button>
          )}
        </div>

        {!selectMode && logs.length > 1 && (
          <p className="mb-2 flex items-center gap-1 text-xs text-gray-500">
            <GripVertical aria-hidden size={14} className="text-gray-400" />
            を長押しで並べ替え
          </p>
        )}

        {selectMode && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white p-2 shadow-sm">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 active:bg-gray-200"
            >
              {allSelected ? "すべて解除" : "すべて選択"}
            </button>
            <span className="text-xs font-semibold text-gray-500">
              {selectedIds.length}件を選択中
            </span>
          </div>
        )}

        {selectMode && (
          <p className="mb-2 text-xs text-gray-500">
            この日の種目をまとめて消すときは「すべて選択」→ 下の削除ボタン
          </p>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-400 shadow-sm">
            まだ記録がありません
          </p>
        ) : selectMode ? (
          // 選択モード: カード全体をタップ領域にして、指でも選びやすくする
          <ul className="space-y-2">
            {logs.map((log) => {
              const checked = selectedIds.includes(log.id);
              return (
                <li key={log.id}>
                  <label
                    className={`flex items-start gap-3 rounded-xl p-3 shadow-sm ${
                      checked ? "bg-red-50 ring-2 ring-red-400" : "bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(log.id)}
                      className="mt-0.5 h-6 w-6 shrink-0 accent-red-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <ExerciseHeading log={log} />
                      </div>
                      <SetLines sets={sortSets(log.workout_sets ?? [])} />
                      {hasMemo(log.memo) && <MemoLine memo={memoText(log.memo)} />}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <SortableList
            items={logs}
            onReorder={reorderLogs}
            itemLabel="種目"
            className="space-y-2"
          >
            {(log, { dragHandle }) => {
              const sets = sortSets(log.workout_sets ?? []);
              const comparison = compareWithPrevious(
                sets,
                previous.get(log.exercise_id) ?? null
              );
              const isEditing = editId === log.id;
              const isMemoEditing = memoEditId === log.id;
              const memo = memoText(log.memo);
              const prevMemo = previousMemos.get(log.exercise_id) ?? null;

              return (
                <div className="rounded-xl bg-white p-3 shadow-sm">
                  {isEditing ? (
                    <div>
                      <p className="mb-2 font-semibold">{exerciseName(log)}</p>
                      <SetInputList
                        sets={editSets}
                        onChange={setEditSets}
                        idPrefix={`edit-${log.id}`}
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          {dragHandle}
                          <ExerciseHeading log={log} />
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => startEdit(log)}
                            className="rounded-lg bg-gray-100 px-3 py-2 text-sm active:bg-gray-200"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => deleteLog(log)}
                            disabled={deleting}
                            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 active:bg-red-100 disabled:opacity-40"
                          >
                            削除
                          </button>
                        </div>
                      </div>

                      <div className="pl-9">
                        <SetLines sets={sets} />
                        <TrendBadges
                          comparison={comparison}
                          maxWeight={maxWeight(sets)}
                          totalVolume={totalVolume(sets)}
                          weightless={sets.length > 0 && !hasWeight(sets)}
                        />

                        {/* メモ(その日のその種目の書き置き) */}
                        {isMemoEditing ? (
                          <div className="mt-2">
                            <label
                              htmlFor={`memo-${log.id}`}
                              className="mb-1 block text-xs font-semibold text-gray-500"
                            >
                              メモ
                            </label>
                            <textarea
                              id={`memo-${log.id}`}
                              value={memoDraft}
                              onChange={(e) => setMemoDraft(e.target.value)}
                              rows={3}
                              maxLength={MEMO_MAX_LENGTH}
                              placeholder={MEMO_PLACEHOLDER}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 leading-relaxed"
                            />
                            <p className="mt-0.5 text-right text-[11px] tabular-nums text-gray-400">
                              {memoDraft.length}/{MEMO_MAX_LENGTH}
                            </p>

                            {/* 前回のメモを見ながら書けるようにする */}
                            {prevMemo && (
                              <div className="mt-1 rounded-lg bg-gray-50 px-2 py-1.5">
                                <p className="text-[11px] font-semibold text-gray-500">
                                  前回のメモ(
                                  {formatShortDateLabel(prevMemo.date)})
                                </p>
                                <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-gray-600">
                                  {prevMemo.memo}
                                </p>
                              </div>
                            )}

                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveMemo(log, memoDraft)}
                                disabled={memoSaving}
                                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={cancelMemoEdit}
                                disabled={memoSaving}
                                className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80 disabled:opacity-40"
                              >
                                キャンセル
                              </button>
                            </div>

                            {memo !== "" && (
                              <button
                                type="button"
                                onClick={() => deleteMemo(log)}
                                disabled={memoSaving}
                                className="mt-2 w-full rounded-lg border border-red-200 py-2 text-xs font-semibold text-red-600 active:bg-red-50 disabled:opacity-40"
                              >
                                メモを削除
                              </button>
                            )}
                          </div>
                        ) : memo !== "" ? (
                          <button
                            type="button"
                            onClick={() => startMemoEdit(log)}
                            aria-label={`${exerciseName(log)}のメモを編集`}
                            className="block w-full active:opacity-70"
                          >
                            <MemoLine memo={memo} />
                          </button>
                        ) : (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startMemoEdit(log)}
                              className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 active:bg-gray-200"
                            >
                              ＋ メモ
                            </button>
                            {prevMemo && (
                              <button
                                type="button"
                                onClick={() => startMemoEdit(log)}
                                className="min-w-0 flex-1 truncate text-left text-xs text-gray-400 active:text-gray-600"
                              >
                                前回({formatShortDateLabel(prevMemo.date)}):{" "}
                                {prevMemo.memo}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          </SortableList>
        )}
      </section>

      {/* 追加フォーム */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">記録を追加</h2>
        {exercises.length === 0 && !loading ? (
          <p className="text-sm text-gray-500">
            種目が登録されていません。「種目」タブから登録してください。
          </p>
        ) : (
          <form onSubmit={addLog}>
            <select
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
              required
              className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">種目を選択</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.muscle_group ? `[${ex.muscle_group}] ` : ""}
                  {ex.name}
                </option>
              ))}
            </select>

            <SetInputList
              sets={newSets}
              onChange={setNewSets}
              idPrefix="new"
            />

            <button
              type="submit"
              disabled={saving || !exerciseId || newSets.length === 0}
              className="mt-3 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              追加する
            </button>
          </form>
        )}
      </section>

      {/* 固定した一括削除バー / スナックバーに隠れないよう、下に余白を足しておく */}
      {(selectMode || undoTarget) && <div className="h-24" aria-hidden />}

      {/*
        一括削除バー(下部ナビの上に固定して、親指で押しやすい位置に置く)。
        押し間違いを防ぐため、キャンセル(左・白地)と削除(右・赤地)で
        色も位置もはっきり分け、間に余白を入れている。
      */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-20 mx-auto w-full max-w-md px-4">
          <div className="flex gap-3 rounded-2xl bg-white p-2 shadow-lg">
            <button
              type="button"
              onClick={exitSelectMode}
              disabled={deleting}
              className="w-[38%] shrink-0 rounded-xl border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 active:bg-gray-100 disabled:opacity-40"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selectedIds.length === 0 || deleting}
              className="min-w-0 flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              {selectedIds.length === 0
                ? "削除する種目を選んでください"
                : `${selectedIds.length}件を削除`}
            </button>
          </div>
        </div>
      )}

      {/* 削除の取り消し(数秒だけ出す) */}
      {undoTarget && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-30 mx-auto w-full max-w-md px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-900 px-4 py-3 text-white shadow-lg">
            <p className="min-w-0 flex-1 text-sm">
              {undoTarget.logs.length}件の種目を削除しました
            </p>
            <button
              type="button"
              onClick={undoDelete}
              disabled={deleting}
              className="shrink-0 rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold active:bg-white/30 disabled:opacity-40"
            >
              元に戻す
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RecordPage />
    </Suspense>
  );
}
