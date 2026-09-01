import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  GEMINI_MODEL,
  GEMINI_NOT_CONFIGURED_MESSAGE,
  getGeminiClient,
} from "@/lib/gemini";
import {
  GOAL_MODE_LABEL,
  NUTRITION_WINDOW_DAYS,
  TREND_WINDOW_DAYS,
  analyzeGoal,
  formatDate,
} from "@/lib/bodyAnalysis";
import { loadGoalAnalysisInput } from "@/lib/bodyData";

// アドバイス生成に数秒かかることがあるため上限を延長
export const maxDuration = 60;

const fmt = (v: number | null, unit = "", digits = 1) =>
  v == null ? "記録なし" : `${v.toFixed(digits)}${unit}`;
const fmtInt = (v: number | null, unit = "") =>
  v == null ? "記録なし" : `${Math.round(v)}${unit}`;
/** プラスマイナスを明示して読ませる(差分・収支用) */
const signed = (v: number | null, unit = "", digits = 1) =>
  v == null ? "算出不可" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

/**
 * POST /api/body/advice
 * 体重推移・目標・直近の食事傾向・トレーニング頻度をもとに、
 * Gemini API で日本語のアドバイスを生成して返す。
 *
 * 集計データはクライアントから受け取らず、このサーバー内で
 * ログインユーザーのセッション(RLS)を通して取得する。
 * Gemini API キーはサーバー内でのみ使用し、クライアントには露出させない。
 */
export async function POST() {
  // ログインユーザーのみ利用可(API キーの悪用防止)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return NextResponse.json(
      { error: GEMINI_NOT_CONFIGURED_MESSAGE },
      { status: 503 }
    );
  }

  const today = formatDate(new Date());

  let analysis;
  try {
    const input = await loadGoalAnalysisInput(supabase, today);
    if (input.weights.length === 0) {
      return NextResponse.json(
        {
          error:
            "体重の記録がまだありません。まずは「からだ」タブで体重を記録してください。",
        },
        { status: 400 }
      );
    }
    analysis = analyzeGoal(input, today);
  } catch (e) {
    console.error("body advice: データ取得に失敗:", e);
    return NextResponse.json(
      {
        error:
          "データの取得に失敗しました。supabase/phase4.sql を実行済みか確認してください。",
      },
      { status: 500 }
    );
  }

  const a = analysis;
  const recentWeights = a.trendPoints;

  const facts = [
    `- 目標モード: ${GOAL_MODE_LABEL[a.mode]}`,
    `- 現在の体重: ${fmt(a.currentWeight, "kg")}(記録日 ${a.currentWeightDate ?? "-"})`,
    `- 目標体重: ${fmt(a.targetWeight, "kg")} / 目標までの差: ${signed(a.weightDiff, "kg")}`,
    `- 現在の体脂肪率: ${fmt(a.currentBodyFat, "%")} / 目標体脂肪率: ${fmt(a.targetBodyFat, "%")}(差: ${signed(a.bodyFatDiff, "%")})`,
    `- 目標達成希望日: ${a.targetDate ?? "未設定"}(残り ${a.daysLeft != null ? `${a.daysLeft}日` : "-"})`,
    `- 目標達成に必要な1日あたりのカロリー収支: ${a.requiredDailyBalance != null ? `${signed(a.requiredDailyBalance, "kcal", 0)}` : "算出不可"}`,
    `- 推定メンテナンスカロリー: ${fmtInt(a.estimatedMaintenance, "kcal/日")}(${
      a.maintenanceBasis === "inbody_bmr"
        ? "InBody の基礎代謝量 × 活動係数1.55"
        : "体重 × 33kcal のざっくり推定"
    })`,
    `- 目標の1日あたり摂取カロリー: ${fmtInt(a.targetDailyCalories, "kcal")} / 推奨タンパク質: ${fmtInt(a.targetDailyProtein, "g")}`,
    `- 直近${NUTRITION_WINDOW_DAYS}日の食事記録: ${a.nutritionDays}日分`,
    `- 平均摂取カロリー: ${fmtInt(a.avgCalories, "kcal/日")}(目標との差: ${a.calorieGap != null ? signed(a.calorieGap, "kcal", 0) : "算出不可"})`,
    `- 平均PFC: P ${fmt(a.avgProtein, "g")} / F ${fmt(a.avgFat, "g")} / C ${fmt(a.avgCarbs, "g")}(タンパク質の過不足: ${a.proteinGap != null ? signed(a.proteinGap, "g", 0) : "算出不可"})`,
    `- 直近${TREND_WINDOW_DAYS}日の体重トレンド: ${a.weeklyPace != null ? `${signed(a.weeklyPace, "kg/週")}` : "算出不可"}(記録${recentWeights}件)`,
    `- 現在のペースでの目標達成予測日: ${a.forecastDate ?? `算出不可(${a.forecastNote ?? "データ不足"})`}`,
    `- 直近${TREND_WINDOW_DAYS}日のトレーニング日数: ${a.workoutDaysLast28}日(週 ${a.workoutsPerWeek ?? 0}回ペース)`,
  ].join("\n");

  const prompt = [
    "あなたは筋トレをしている人をサポートする、経験豊富で親しみやすい日本語のトレーニングコーチです。",
    "以下は、あるユーザーの体組成・目標・直近の食事とトレーニングの記録から自動計算した数値データです。",
    "",
    "【データ】",
    facts,
    "",
    "【指示】",
    "このデータをもとに、日本語でアドバイスしてください。次の構成で書いてください。",
    "1. 「現状のまとめ」: いま目標に対してどういう位置にいるかを2〜3文で。良い点があれば必ず褒める。",
    "2. 「気をつけたいポイント」: 数値から読み取れる課題を2〜3個、箇条書きで。必ず具体的な数値を引用する。",
    "3. 「今週やること」: 明日から実行できる具体的なアクションを3個、箇条書きで。食事(カロリー・タンパク質)とトレーニングの両面から。",
    "",
    "【ルール】",
    "- 全体で400〜600文字程度。マークダウンの見出し(#)は使わず、「1. 現状のまとめ」のような行頭の見出しと「・」の箇条書きで書く。",
    "- データが「記録なし」「算出不可」の項目については断定せず、記録を増やすことを勧める。",
    "- 減量は週0.5〜1%、増量は週0.25〜0.5%の体重変化が健康的とされる。無理なペースが必要な場合は目標日の見直しを提案する。",
    "- 医療的な診断や断定はしない。体調不良や極端な数値がある場合は専門家への相談を勧める。",
    "- 前置きや「承知しました」などは書かず、本文だけを出力する。",
  ].join("\n");

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const advice = (response.text ?? "").trim();
    if (!advice) {
      return NextResponse.json(
        { error: "アドバイスを生成できませんでした。もう一度お試しください。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ advice, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("body advice failed:", e);
    return NextResponse.json(
      {
        error:
          "アドバイスの生成に失敗しました。時間をおいて再度お試しください。",
      },
      { status: 500 }
    );
  }
}
