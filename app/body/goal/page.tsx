"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { loadGoalAnalysisInput } from "@/lib/bodyData";
import {
  GOAL_MODE_LABEL,
  NUTRITION_WINDOW_DAYS,
  TREND_WINDOW_DAYS,
  analyzeGoal,
  formatDate,
  type GoalAnalysis,
} from "@/lib/bodyAnalysis";
import type { BodyGoal, GoalMode } from "@/lib/types";

const PHASE4_SETUP_HINT = "(supabase/phase4.sql を実行済みか確認してください)";

const MODES: { value: GoalMode; label: string; icon: string }[] = [
  { value: "bulk", label: "増量", icon: "📈" },
  { value: "cut", label: "減量", icon: "📉" },
  { value: "maintain", label: "維持", icon: "⚖️" },
];

/** カロリー/タンパク質の過不足を「許容範囲」とみなす幅 */
const CALORIE_TOLERANCE = 150; // kcal
const PROTEIN_TOLERANCE = 10; // g

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${y}年${m}月${d}日(${weekday})`;
}

const signed = (v: number | null, digits = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

/** 状態バッジ。色だけに意味を持たせず、必ずアイコン+ラベルとセットで表示する */
function StatusBadge({
  status,
  children,
}: {
  status: "good" | "warning";
  children: React.ReactNode;
}) {
  const icon = status === "good" ? "✅" : "⚠️";
  const className =
    status === "good"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-amber-50 text-amber-800";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  );
}

/** 見出し + 大きな数値 + 補足 のスタットタイル */
function StatTile({
  label,
  value,
  unit,
  note,
  badge,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 leading-none">
        <span className="text-xl font-bold">{value}</span>
        {unit && <span className="ml-0.5 text-xs text-gray-500">{unit}</span>}
      </p>
      {badge && <p className="mt-1">{badge}</p>}
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

export default function BodyGoalPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<GoalAnalysis | null>(null);

  // 目標フォーム
  const [mode, setMode] = useState<GoalMode>("maintain");
  const [targetWeight, setTargetWeight] = useState("");
  const [targetBodyFat, setTargetBodyFat] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  // AI アドバイス
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceNote, setAdviceNote] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const today = formatDate(new Date());

    const { data: goalRow, error: goalError } = await supabase
      .from("body_goals")
      .select("*")
      .maybeSingle();
    if (goalError) {
      setError(`目標の取得に失敗しました: ${goalError.message}${PHASE4_SETUP_HINT}`);
      return;
    }
    const goal = (goalRow as BodyGoal | null) ?? null;
    setMode(goal?.mode ?? "maintain");
    setTargetWeight(
      goal?.target_weight_kg != null ? String(Number(goal.target_weight_kg)) : ""
    );
    setTargetBodyFat(
      goal?.target_body_fat_percent != null
        ? String(Number(goal.target_body_fat_percent))
        : ""
    );
    setTargetDate(goal?.target_date ?? "");

    try {
      const input = await loadGoalAnalysisInput(supabase, today);
      setAnalysis(analyzeGoal(input, today));
      setError(null);
    } catch (e) {
      setError(
        `分析データの取得に失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }${PHASE4_SETUP_HINT}`
      );
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const saveGoal = async () => {
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
    const toNumber = (v: string) => {
      const t = v.trim();
      if (t === "") return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };
    const { error: upsertError } = await supabase.from("body_goals").upsert(
      {
        user_id: user.id,
        mode,
        target_weight_kg: toNumber(targetWeight),
        target_body_fat_percent: toNumber(targetBodyFat),
        target_date: targetDate || null,
      },
      { onConflict: "user_id" }
    );
    if (upsertError) {
      setError(`目標の保存に失敗しました: ${upsertError.message}${PHASE4_SETUP_HINT}`);
    } else {
      setNotice("目標を保存しました。");
      await load();
    }
    setSaving(false);
  };

  const generateAdvice = async () => {
    setGenerating(true);
    setAdviceNote(null);
    try {
      const res = await fetch("/api/body/advice", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setAdviceNote(json.error ?? "アドバイスの生成に失敗しました。");
        return;
      }
      setAdvice(json.advice as string);
    } catch {
      setAdviceNote("アドバイスの生成に失敗しました。時間をおいてお試しください。");
    } finally {
      setGenerating(false);
    }
  };

  const a = analysis;

  // 摂取カロリー・タンパク質の過不足判定(色だけでなくラベルでも示す)
  const calorieStatus =
    a?.calorieGap == null
      ? null
      : Math.abs(a.calorieGap) <= CALORIE_TOLERANCE
        ? ({ status: "good", label: "ほぼ目標どおり" } as const)
        : a.calorieGap > 0
          ? ({ status: "warning", label: "目標より超過" } as const)
          : ({ status: "warning", label: "目標より不足" } as const);

  const proteinStatus =
    a?.proteinGap == null
      ? null
      : a.proteinGap >= -PROTEIN_TOLERANCE
        ? ({ status: "good", label: "足りています" } as const)
        : ({ status: "warning", label: "不足しています" } as const);

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">🎯 目標と分析</h1>
        <Link
          href="/body"
          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 active:bg-gray-200"
        >
          ‹ からだ
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
          {/* 目標設定 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">目標設定</h2>

            <p className="mb-1 text-xs text-gray-500">モード</p>
            <div className="mb-3 grid grid-cols-3 gap-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  aria-pressed={mode === m.value}
                  className={`rounded-lg py-2 text-xs font-semibold ${
                    mode === m.value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 active:bg-gray-200"
                  }`}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">
                目標体重(kg)
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="例: 68"
                  value={targetWeight}
                  onChange={(e) => setTargetWeight(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-500">
                目標体脂肪率(%)
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="例: 12"
                  value={targetBodyFat}
                  onChange={(e) => setTargetBodyFat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                />
              </label>
            </div>

            <label className="mt-2 block text-xs text-gray-500">
              目標達成希望日
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>

            <button
              onClick={saveGoal}
              disabled={saving}
              className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              {saving ? "保存中..." : "目標を保存する"}
            </button>
            <p className="mt-1 text-xs text-gray-500">
              未入力の項目は分析から除外されます(すべて任意)。
            </p>
          </section>

          {/* 現在地と目標の差分 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              現在地 → 目標({GOAL_MODE_LABEL[a?.mode ?? mode]}モード)
            </h2>
            {!a || a.currentWeight == null ? (
              <p className="py-4 text-center text-sm text-gray-400">
                体重の記録がまだありません。
                <br />
                「からだ」タブから体重を記録すると分析が始まります。
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile
                    label="現在の体重"
                    value={a.currentWeight.toFixed(1)}
                    unit="kg"
                    note={
                      a.currentWeightDate
                        ? formatDateLabel(a.currentWeightDate)
                        : undefined
                    }
                  />
                  <StatTile
                    label="目標体重まで"
                    value={a.weightDiff != null ? signed(a.weightDiff) : "—"}
                    unit={a.weightDiff != null ? "kg" : undefined}
                    note={
                      a.targetWeight != null
                        ? `目標 ${a.targetWeight.toFixed(1)}kg`
                        : "目標体重が未設定です"
                    }
                  />
                  <StatTile
                    label="現在の体脂肪率"
                    value={a.currentBodyFat != null ? a.currentBodyFat.toFixed(1) : "—"}
                    unit={a.currentBodyFat != null ? "%" : undefined}
                    note={
                      a.currentBodyFatDate
                        ? formatDateLabel(a.currentBodyFatDate)
                        : "InBody の記録がありません"
                    }
                  />
                  <StatTile
                    label="目標体脂肪率まで"
                    value={a.bodyFatDiff != null ? signed(a.bodyFatDiff) : "—"}
                    unit={a.bodyFatDiff != null ? "%" : undefined}
                    note={
                      a.targetBodyFat != null
                        ? `目標 ${a.targetBodyFat.toFixed(1)}%`
                        : "目標体脂肪率が未設定です"
                    }
                  />
                </div>
                {a.targetDate && (
                  <p className="mt-2 text-xs text-gray-500">
                    目標達成希望日: {formatDateLabel(a.targetDate)}(
                    {a.daysLeft != null && a.daysLeft >= 0
                      ? `残り ${a.daysLeft}日`
                      : "期限を過ぎています"}
                    )
                  </p>
                )}
              </>
            )}
          </section>

          {/* 必要なカロリー収支 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              目標達成に必要なカロリー収支
            </h2>
            {!a || a.requiredDailyBalance == null ? (
              <p className="py-4 text-center text-sm text-gray-400">
                体重の記録・目標体重・目標達成希望日(未来の日付)がそろうと計算できます。
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile
                    label="1日あたりの収支"
                    value={signed(a.requiredDailyBalance, 0)}
                    unit="kcal"
                    note={
                      a.requiredDailyBalance > 0
                        ? "余剰(オーバーカロリー)が必要"
                        : a.requiredDailyBalance < 0
                          ? "不足(アンダーカロリー)が必要"
                          : "収支ゼロを維持"
                    }
                  />
                  <StatTile
                    label="1日あたりの目標摂取"
                    value={
                      a.targetDailyCalories != null
                        ? String(a.targetDailyCalories)
                        : "—"
                    }
                    unit={a.targetDailyCalories != null ? "kcal" : undefined}
                    note={
                      a.maintenanceBasis === "inbody_bmr"
                        ? `維持 ${a.estimatedMaintenance}kcal(InBody 基礎代謝 × 1.55)`
                        : a.maintenanceBasis === "weight_estimate"
                          ? `維持 ${a.estimatedMaintenance}kcal(体重からの概算)`
                          : undefined
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  体重 1kg の増減に必要なカロリーを 7,200kcal として計算した目安です。
                  {a.maintenanceBasis === "weight_estimate" &&
                    " InBody の基礎代謝量を記録すると精度が上がります。"}
                </p>
              </>
            )}
          </section>

          {/* 直近の食事傾向 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              直近{NUTRITION_WINDOW_DAYS}日の食事傾向
            </h2>
            {!a || a.nutritionDays === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">
                直近{NUTRITION_WINDOW_DAYS}日の食事記録がありません。
                <br />
                「食事」タブで記録すると、摂取カロリー・タンパク質の過不足を判定できます。
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile
                    label="平均摂取カロリー"
                    value={a.avgCalories != null ? String(a.avgCalories) : "—"}
                    unit="kcal/日"
                    badge={
                      calorieStatus ? (
                        <StatusBadge status={calorieStatus.status}>
                          {calorieStatus.label}
                        </StatusBadge>
                      ) : undefined
                    }
                    note={
                      a.calorieGap != null
                        ? `目標との差 ${signed(a.calorieGap, 0)}kcal`
                        : "目標カロリーが計算できていません"
                    }
                  />
                  <StatTile
                    label="平均タンパク質"
                    value={a.avgProtein != null ? a.avgProtein.toFixed(1) : "—"}
                    unit="g/日"
                    badge={
                      proteinStatus ? (
                        <StatusBadge status={proteinStatus.status}>
                          {proteinStatus.label}
                        </StatusBadge>
                      ) : undefined
                    }
                    note={
                      a.targetDailyProtein != null
                        ? `推奨 ${a.targetDailyProtein}g(体重 × 2.0g)`
                        : undefined
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  食事記録がある{a.nutritionDays}日分の平均です(平均PFC: P{" "}
                  {a.avgProtein?.toFixed(1) ?? "—"}g / F {a.avgFat?.toFixed(1) ?? "—"}g
                  / C {a.avgCarbs?.toFixed(1) ?? "—"}g)。
                </p>
              </>
            )}
          </section>

          {/* トレンドと達成予測 */}
          <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              体重トレンドと達成予測
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label={`直近${TREND_WINDOW_DAYS}日のペース`}
                value={a?.weeklyPace != null ? signed(a.weeklyPace, 2) : "—"}
                unit={a?.weeklyPace != null ? "kg/週" : undefined}
                note={
                  a && a.trendPoints >= 2
                    ? `体重記録 ${a.trendPoints}件から算出`
                    : `直近${TREND_WINDOW_DAYS}日の体重記録が2件以上必要です`
                }
              />
              <StatTile
                label="目標達成予測日"
                value={a?.forecastDate ? formatDateLabel(a.forecastDate) : "—"}
                note={a?.forecastNote ?? "現在のペースが続いた場合の予測です"}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              トレーニング頻度: 直近{TREND_WINDOW_DAYS}日で {a?.workoutDaysLast28 ?? 0}日
              (週 {a?.workoutsPerWeek ?? 0}回ペース)
            </p>
          </section>

          {/* AI アドバイス */}
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-600">
              🤖 AI からのアドバイス
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              体重推移・目標・直近の食事傾向・トレーニング頻度をもとに、AI
              が日本語でアドバイスを作成します。
            </p>
            <button
              onClick={generateAdvice}
              disabled={generating}
              className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              {generating
                ? "生成中..."
                : advice
                  ? "もう一度アドバイスをもらう"
                  : "アドバイスをもらう"}
            </button>

            {adviceNote && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {adviceNote}
              </p>
            )}

            {advice && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                  {advice}
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  ※ AI による一般的な目安です。体調に不安がある場合は専門家に相談してください。
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
