"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BodyTrendCharts, { type TrendRange } from "@/components/BodyTrendCharts";
import { formatDateLabel, todayString } from "@/lib/date";
import type { BodyLog } from "@/lib/types";

const PHASE4_SETUP_HINT =
  "(supabase/phase4.sql を実行済みか確認してください)";

/**
 * InBody の入力項目(すべて任意)。
 * Phase 4 で体重記録と InBody 記録を 1 つの画面・1 つのテーブルにまとめたので、
 * 体重だけ記録する日も、InBody を測れた日も、同じフォームで入力する。
 */
const INBODY_FIELDS = [
  { key: "body_fat_percent", label: "体脂肪率", unit: "%", step: "0.1", digits: 1 },
  { key: "skeletal_muscle_kg", label: "骨格筋量", unit: "kg", step: "0.1", digits: 1 },
  { key: "body_fat_mass_kg", label: "体脂肪量", unit: "kg", step: "0.1", digits: 1 },
  { key: "bmr_kcal", label: "基礎代謝量", unit: "kcal", step: "1", digits: 0 },
  { key: "body_water_l", label: "体水分量", unit: "L", step: "0.1", digits: 1 },
] as const;

type InbodyFieldKey = (typeof INBODY_FIELDS)[number]["key"];

type InbodyForm = Record<InbodyFieldKey, string>;

const emptyInbodyForm = (): InbodyForm => ({
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

const toInput = (v: number | null): string =>
  v == null ? "" : String(Number(v));

const fmt = (v: number | null, digits = 1) =>
  v == null ? "—" : Number(v).toFixed(digits);

export default function BodyPage() {
  const [logs, setLogs] = useState<BodyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [range, setRange] = useState<TrendRange>("3m");

  // 記録フォーム(体重が必須、InBody の項目はすべて任意)
  const [logDate, setLogDate] = useState(todayString);
  const [weight, setWeight] = useState("");
  const [inbodyForm, setInbodyForm] = useState<InbodyForm>(emptyInbodyForm);
  const [inbodyOpen, setInbodyOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("body_logs")
      .select("*")
      .order("log_date", { ascending: true })
      .limit(1000);
    if (loadError) {
      setError(
        `からだの記録の取得に失敗しました: ${loadError.message}${PHASE4_SETUP_HINT}`
      );
      return null;
    }
    const rows = (data as BodyLog[]) ?? [];
    setError(null);
    setLogs(rows);
    return rows;
  }, []);

  /** 選んだ日付の既存記録をフォームに読み込む(1 日 1 件なので上書き編集になる) */
  const applyRecord = (date: string, rows: BodyLog[]) => {
    const existing = rows.find((l) => l.log_date === date);
    if (!existing) {
      setWeight("");
      setInbodyForm(emptyInbodyForm());
      setMemo("");
      return;
    }
    setWeight(toInput(existing.weight_kg));
    setInbodyForm({
      body_fat_percent: toInput(existing.body_fat_percent),
      skeletal_muscle_kg: toInput(existing.skeletal_muscle_kg),
      body_fat_mass_kg: toInput(existing.body_fat_mass_kg),
      bmr_kcal: toInput(existing.bmr_kcal),
      body_water_l: toInput(existing.body_water_l),
    });
    setMemo(existing.memo ?? "");
    // InBody の値が入っている記録は、開いた状態で見せる
    if (
      INBODY_FIELDS.some((f) => existing[f.key] != null)
    ) {
      setInbodyOpen(true);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const rows = await load();
      if (rows) applyRecord(todayString(), rows);
      setLoading(false);
    })();
  }, [load]);

  const selectDate = (date: string) => {
    setLogDate(date);
    applyRecord(date, logs);
    setNotice(null);
  };

  const save = async () => {
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0) {
      setError("体重は 0 より大きい数値で入力してください。");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const values = Object.fromEntries(
      INBODY_FIELDS.map((f) => [f.key, toNullableNumber(inbodyForm[f.key])])
    ) as Record<InbodyFieldKey, number | null>;

    // 1 日 1 件なので同じ日付は上書きする
    const { error: upsertError } = await supabase.from("body_logs").upsert(
      {
        user_id: user.id,
        log_date: logDate,
        weight_kg: value,
        ...values,
        memo: memo.trim() || null,
      },
      { onConflict: "user_id,log_date" }
    );
    if (upsertError) {
      setError(`保存に失敗しました: ${upsertError.message}${PHASE4_SETUP_HINT}`);
    } else {
      setNotice(`${formatDateLabel(logDate)}の記録を保存しました。`);
      const rows = await load();
      if (rows) applyRecord(logDate, rows);
    }
    setSaving(false);
  };

  const remove = async (log: BodyLog) => {
    if (!confirm(`${formatDateLabel(log.log_date)}の記録を削除しますか?`)) return;
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("body_logs")
      .delete()
      .eq("id", log.id);
    if (delError) {
      setError(`削除に失敗しました: ${delError.message}`);
    } else {
      const rows = await load();
      if (rows) applyRecord(logDate, rows);
    }
  };

  const exists = logs.some((l) => l.log_date === logDate);
  // 一覧は新しい順に表示する
  const logsDesc = [...logs].reverse();

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
              logs={logs}
              range={range}
              onRangeChange={setRange}
            />
          </section>

          {/* 記録フォーム(体重 + InBody を 1 画面にまとめる) */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">記録する</h2>
            <label className="block text-xs text-gray-500">
              日付
              <input
                type="date"
                value={logDate}
                onChange={(e) => e.target.value && selectDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="mt-2 block text-xs text-gray-500">
              体重(kg)<span className="ml-1 text-red-500">必須</span>
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

            {/* InBody は測れた日だけ入力すればよいので、初期状態は折りたたむ */}
            <button
              type="button"
              onClick={() => setInbodyOpen((v) => !v)}
              aria-expanded={inbodyOpen}
              className="mt-3 flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-left active:bg-gray-100"
            >
              <span className="text-xs font-semibold text-gray-600">
                InBody の項目(任意)
              </span>
              <span className="text-xs text-blue-600">
                {inbodyOpen ? "閉じる ▲" : "開く ▼"}
              </span>
            </button>

            {inbodyOpen && (
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
            )}

            <label className="mt-2 block text-xs text-gray-500">
              メモ(任意)
              <input
                type="text"
                placeholder="例: 起床後・トイレ後 / ジムの InBody で測定"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>

            <button
              onClick={save}
              disabled={saving}
              className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              {saving ? "保存中..." : exists ? "上書き保存する" : "記録する"}
            </button>
            <p className="mt-1 text-xs text-gray-500">
              記録は 1 日 1 件です。同じ日付で保存すると上書きされます。
              InBody を測れない日は体重だけでも記録できます。
            </p>
          </section>

          {/* 記録一覧(グラフの値を数値でも確認できる表ビュー) */}
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">記録一覧</h2>
            {logsDesc.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                まだ記録がありません
              </p>
            ) : (
              <ul className="space-y-3">
                {logsDesc.slice(0, 60).map((log) => {
                  const inbodyValues = INBODY_FIELDS.filter(
                    (f) => log[f.key] != null
                  );
                  return (
                    <li
                      key={log.id}
                      className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold tabular-nums">
                            {fmt(log.weight_kg, 1)}
                            <span className="ml-0.5 text-xs font-normal text-gray-500">
                              kg
                            </span>
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {formatDateLabel(log.log_date)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => selectDate(log.log_date)}
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs active:bg-gray-200"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => remove(log)}
                            className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600 active:bg-red-100"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      {inbodyValues.length > 0 && (
                        <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
                          {inbodyValues.map((f) => (
                            <div key={f.key}>
                              <dt className="text-gray-500">{f.label}</dt>
                              <dd className="font-semibold tabular-nums">
                                {fmt(log[f.key], f.digits)}
                                <span className="ml-0.5 font-normal text-gray-500">
                                  {f.unit}
                                </span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {log.memo && (
                        <p className="mt-1 truncate text-xs text-gray-500">
                          {log.memo}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
