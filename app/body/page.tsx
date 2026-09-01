"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BodyTrendCharts, { type TrendRange } from "@/components/BodyTrendCharts";
import type { InbodyLog, WeightLog } from "@/lib/types";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${y}年${m}月${d}日(${weekday})`;
}

const PHASE3_SETUP_HINT =
  "(supabase/phase3.sql を実行済みか確認してください)";

/** InBody の入力項目(すべて任意。入力された項目だけ保存する) */
const INBODY_FIELDS = [
  { key: "weight_kg", label: "体重", unit: "kg", step: "0.1" },
  { key: "body_fat_percent", label: "体脂肪率", unit: "%", step: "0.1" },
  { key: "skeletal_muscle_kg", label: "骨格筋量", unit: "kg", step: "0.1" },
  { key: "body_fat_mass_kg", label: "体脂肪量", unit: "kg", step: "0.1" },
  { key: "bmr_kcal", label: "基礎代謝量", unit: "kcal", step: "1" },
  { key: "body_water_l", label: "体水分量", unit: "L", step: "0.1" },
] as const;

type InbodyFieldKey = (typeof INBODY_FIELDS)[number]["key"];

type InbodyForm = Record<InbodyFieldKey, string>;

const emptyInbodyForm = (): InbodyForm => ({
  weight_kg: "",
  body_fat_percent: "",
  skeletal_muscle_kg: "",
  body_fat_mass_kg: "",
  bmr_kcal: "",
  body_water_l: "",
});

/** 空文字は null(未入力)、それ以外は数値にする */
const toNullableNumber = (v: string): number | null => {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: number | null, digits = 1) =>
  v == null ? "—" : Number(v).toFixed(digits);

export default function BodyPage() {
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [inbodyLogs, setInbodyLogs] = useState<InbodyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [range, setRange] = useState<TrendRange>("3m");

  // 体重フォーム
  const [weightDate, setWeightDate] = useState(todayString);
  const [weight, setWeight] = useState("");
  const [weightMemo, setWeightMemo] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);

  // InBody フォーム
  const [inbodyOpen, setInbodyOpen] = useState(false);
  const [inbodyDate, setInbodyDate] = useState(todayString);
  const [inbodyForm, setInbodyForm] = useState<InbodyForm>(emptyInbodyForm);
  const [inbodyMemo, setInbodyMemo] = useState("");
  const [savingInbody, setSavingInbody] = useState(false);

  // 記録一覧のタブ
  const [listTab, setListTab] = useState<"weight" | "inbody">("weight");

  /** 記録を取り直し、取得できたら最新の配列を返す */
  const load = useCallback(async () => {
    const supabase = createClient();
    const [wRes, iRes] = await Promise.all([
      supabase
        .from("weight_logs")
        .select("*")
        .order("log_date", { ascending: true })
        .limit(1000),
      supabase
        .from("inbody_logs")
        .select("*")
        .order("measured_date", { ascending: true })
        .limit(1000),
    ]);
    if (wRes.error) {
      setError(`体重記録の取得に失敗しました: ${wRes.error.message}${PHASE3_SETUP_HINT}`);
      return null;
    }
    if (iRes.error) {
      setError(`InBody 記録の取得に失敗しました: ${iRes.error.message}${PHASE3_SETUP_HINT}`);
      return null;
    }
    const weights = (wRes.data as WeightLog[]) ?? [];
    const inbodies = (iRes.data as InbodyLog[]) ?? [];
    setError(null);
    setWeightLogs(weights);
    setInbodyLogs(inbodies);
    return { weights, inbodies };
  }, []);

  // 選んだ日付の既存記録をフォームに読み込む(1 日 1 件なので上書き編集になる)
  const applyWeightRecord = (date: string, logs: WeightLog[]) => {
    const existing = logs.find((l) => l.log_date === date);
    setWeight(existing ? String(Number(existing.weight_kg)) : "");
    setWeightMemo(existing?.memo ?? "");
  };

  const applyInbodyRecord = (date: string, logs: InbodyLog[]) => {
    const existing = logs.find((l) => l.measured_date === date);
    if (!existing) {
      setInbodyForm(emptyInbodyForm());
      setInbodyMemo("");
      return;
    }
    setInbodyForm({
      weight_kg: existing.weight_kg != null ? String(Number(existing.weight_kg)) : "",
      body_fat_percent:
        existing.body_fat_percent != null ? String(Number(existing.body_fat_percent)) : "",
      skeletal_muscle_kg:
        existing.skeletal_muscle_kg != null ? String(Number(existing.skeletal_muscle_kg)) : "",
      body_fat_mass_kg:
        existing.body_fat_mass_kg != null ? String(Number(existing.body_fat_mass_kg)) : "",
      bmr_kcal: existing.bmr_kcal != null ? String(Number(existing.bmr_kcal)) : "",
      body_water_l:
        existing.body_water_l != null ? String(Number(existing.body_water_l)) : "",
    });
    setInbodyMemo(existing.memo ?? "");
  };

  /** 記録を取り直したうえで、選択中の日付のフォームを最新の内容に合わせる */
  const reload = async (
    nextWeightDate = weightDate,
    nextInbodyDate = inbodyDate
  ) => {
    const data = await load();
    if (!data) return;
    applyWeightRecord(nextWeightDate, data.weights);
    applyInbodyRecord(nextInbodyDate, data.inbodies);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const selectWeightDate = (date: string) => {
    setWeightDate(date);
    applyWeightRecord(date, weightLogs);
  };

  const selectInbodyDate = (date: string) => {
    setInbodyDate(date);
    applyInbodyRecord(date, inbodyLogs);
  };

  const saveWeight = async () => {
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) {
      setError("体重は 0 より大きい数値で入力してください。");
      return;
    }
    setSavingWeight(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingWeight(false);
      return;
    }
    // 1 日 1 件なので同じ日付は上書きする
    const { error: upsertError } = await supabase.from("weight_logs").upsert(
      {
        user_id: user.id,
        log_date: weightDate,
        weight_kg: value,
        memo: weightMemo.trim() || null,
      },
      { onConflict: "user_id,log_date" }
    );
    if (upsertError) {
      setError(`保存に失敗しました: ${upsertError.message}${PHASE3_SETUP_HINT}`);
    } else {
      setNotice(`${formatDateLabel(weightDate)}の体重を保存しました。`);
      await reload();
    }
    setSavingWeight(false);
  };

  const saveInbody = async () => {
    const values = Object.fromEntries(
      INBODY_FIELDS.map((f) => [f.key, toNullableNumber(inbodyForm[f.key])])
    ) as Record<InbodyFieldKey, number | null>;

    const hasAny = Object.values(values).some((v) => v != null);
    if (!hasAny) {
      setError("InBody は少なくとも 1 項目を入力してください。");
      return;
    }
    setSavingInbody(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingInbody(false);
      return;
    }
    const { error: upsertError } = await supabase.from("inbody_logs").upsert(
      {
        user_id: user.id,
        measured_date: inbodyDate,
        ...values,
        memo: inbodyMemo.trim() || null,
      },
      { onConflict: "user_id,measured_date" }
    );
    if (upsertError) {
      setError(`保存に失敗しました: ${upsertError.message}${PHASE3_SETUP_HINT}`);
    } else {
      setNotice(`${formatDateLabel(inbodyDate)}の InBody データを保存しました。`);
      await reload();
    }
    setSavingInbody(false);
  };

  const deleteWeight = async (log: WeightLog) => {
    if (!confirm(`${formatDateLabel(log.log_date)}の体重記録を削除しますか?`)) return;
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("weight_logs")
      .delete()
      .eq("id", log.id);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      await reload();
    }
  };

  const deleteInbody = async (log: InbodyLog) => {
    if (!confirm(`${formatDateLabel(log.measured_date)}の InBody 記録を削除しますか?`))
      return;
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("inbody_logs")
      .delete()
      .eq("id", log.id);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      await reload();
    }
  };

  const weightExists = weightLogs.some((l) => l.log_date === weightDate);
  const inbodyExists = inbodyLogs.some((l) => l.measured_date === inbodyDate);

  // 一覧は新しい順に表示する
  const weightDesc = [...weightLogs].reverse();
  const inbodyDesc = [...inbodyLogs].reverse();

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">⚖️ からだ</h1>
        <Link
          href="/body/goal"
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white active:opacity-80"
        >
          🎯 目標と分析 ›
        </Link>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}
      {notice && (
        <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
      ) : (
        <>
          {/* 推移グラフ */}
          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">推移</h2>
            <BodyTrendCharts
              weightLogs={weightLogs}
              inbodyLogs={inbodyLogs}
              range={range}
              onRangeChange={setRange}
            />
          </section>

          {/* 体重の記録 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              体重を記録
            </h2>
            <label className="block text-xs text-gray-500">
              日付
              <input
                type="date"
                value={weightDate}
                onChange={(e) => e.target.value && selectWeightDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="mt-2 block text-xs text-gray-500">
              体重(kg)
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="例: 70.5"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="mt-2 block text-xs text-gray-500">
              メモ(任意)
              <input
                type="text"
                placeholder="例: 起床後・トイレ後"
                value={weightMemo}
                onChange={(e) => setWeightMemo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <button
              onClick={saveWeight}
              disabled={savingWeight}
              className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              {savingWeight ? "保存中..." : weightExists ? "上書き保存する" : "記録する"}
            </button>
            <p className="mt-1 text-xs text-gray-500">
              体重は 1 日 1 件です。同じ日付で記録すると上書きされます。
            </p>
          </section>

          {/* InBody の記録 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <button
              type="button"
              onClick={() => setInbodyOpen((v) => !v)}
              aria-expanded={inbodyOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-semibold text-gray-600">
                InBody データを記録
              </span>
              <span className="text-xs text-blue-600">
                {inbodyOpen ? "閉じる" : "開く"} {inbodyOpen ? "▲" : "▼"}
              </span>
            </button>

            {inbodyOpen && (
              <div className="mt-3">
                <label className="block text-xs text-gray-500">
                  測定日
                  <input
                    type="date"
                    value={inbodyDate}
                    onChange={(e) => e.target.value && selectInbodyDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </label>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {INBODY_FIELDS.map((f) => (
                    <label key={f.key} className="text-xs text-gray-500">
                      {f.label}({f.unit})
                      <input
                        type="number"
                        inputMode="decimal"
                        step={f.step}
                        min="0"
                        value={inbodyForm[f.key]}
                        onChange={(e) =>
                          setInbodyForm((prev) => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                      />
                    </label>
                  ))}
                </div>

                <label className="mt-2 block text-xs text-gray-500">
                  メモ(任意)
                  <input
                    type="text"
                    placeholder="例: ジムの InBody で測定"
                    value={inbodyMemo}
                    onChange={(e) => setInbodyMemo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </label>

                <button
                  onClick={saveInbody}
                  disabled={savingInbody}
                  className="mt-3 w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-50"
                >
                  {savingInbody
                    ? "保存中..."
                    : inbodyExists
                      ? "上書き保存する"
                      : "記録する"}
                </button>
                <p className="mt-1 text-xs text-gray-500">
                  入力した項目だけが保存されます。空欄の項目は記録されません。
                </p>
              </div>
            )}
          </section>

          {/* 記録一覧(グラフの値を数値でも確認できる表ビュー) */}
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">記録一覧</h2>
            <div className="mb-3 flex gap-1">
              {(
                [
                  ["weight", "体重"],
                  ["inbody", "InBody"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setListTab(value)}
                  className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                    listTab === value
                      ? "bg-gray-800 text-white"
                      : "bg-gray-100 text-gray-600 active:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {listTab === "weight" ? (
              weightDesc.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  まだ体重の記録がありません
                </p>
              ) : (
                <ul className="space-y-2">
                  {weightDesc.slice(0, 60).map((log) => (
                    <li
                      key={log.id}
                      className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tabular-nums">
                          {Number(log.weight_kg).toFixed(1)}
                          <span className="ml-0.5 text-xs font-normal text-gray-500">
                            kg
                          </span>
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {formatDateLabel(log.log_date)}
                          {log.memo ? ` · ${log.memo}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => selectWeightDate(log.log_date)}
                          className="rounded-lg bg-gray-100 px-3 py-2 text-sm active:bg-gray-200"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => deleteWeight(log)}
                          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 active:bg-red-100"
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : inbodyDesc.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                まだ InBody の記録がありません
              </p>
            ) : (
              <ul className="space-y-3">
                {inbodyDesc.slice(0, 60).map((log) => (
                  <li
                    key={log.id}
                    className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-gray-700">
                        {formatDateLabel(log.measured_date)}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => {
                            setInbodyOpen(true);
                            selectInbodyDate(log.measured_date);
                          }}
                          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs active:bg-gray-200"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => deleteInbody(log)}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600 active:bg-red-100"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                      {INBODY_FIELDS.map((f) => {
                        const value = log[f.key];
                        if (value == null) return null;
                        return (
                          <div key={f.key}>
                            <dt className="text-gray-500">{f.label}</dt>
                            <dd className="font-semibold tabular-nums">
                              {fmt(Number(value), f.key === "bmr_kcal" ? 0 : 1)}
                              <span className="ml-0.5 font-normal text-gray-500">
                                {f.unit}
                              </span>
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    {log.memo && (
                      <p className="mt-1 truncate text-xs text-gray-500">{log.memo}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
