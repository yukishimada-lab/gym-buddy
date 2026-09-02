"use client";

import { VIZ } from "@/lib/viz";
import { formatDateLabel } from "@/lib/date";
import {
  formatNumber,
  formatWeight,
  hasWeight,
  maxWeight,
  sortSets,
  totalReps,
  totalVolume,
} from "@/lib/workoutStats";
import type { DaySummary, MealType } from "@/lib/types";

/**
 * 1 日のサマリーを 1 枚の縦長画像にするためのカード。
 *
 * ■ html-to-image に渡す前提での作りかた
 * - スタイルはすべてインラインの 16 進カラーで書く。
 *   Tailwind v4 の色は oklch() なので、DOM を SVG に写して描画する
 *   html-to-image では環境によって色が落ちることがある。
 * - フォントは端末に必ずある日本語フォントだけを指定する(Web フォントを
 *   読み込むと、書き出し時にフォントが間に合わず豆腐になることがある)。
 * - 画像・外部リソースは一切使わない(CORS で書き出しが失敗するため)。
 *
 * ■ 配色(dataviz スキルの指針)
 * - カテゴリカルは lib/viz.ts の固定スロット順(青=トレーニング / 橙=食事 /
 *   アクア=からだ)だけを使い、順番を入れ替えない。
 * - 部位は 8 区分あるためカテゴリカル色は割り当てず、見出しの文字で区別する
 *   (9 色目を作らない・色だけに意味を持たせない)。
 * - PFC の積み上げバーは各セグメントの間に 2px の隙間を空け、色の凡例だけに
 *   頼らないよう「P 150g」のように直接ラベルを併記する。
 */

/** 端末にある日本語フォントだけで組む(iOS Safari / Android / PC 共通) */
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

/** 書き出す画像の幅(px)。実際の PNG は pixelRatio 2 で 2 倍になる */
export const CARD_WIDTH = 640;

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function SectionHeading({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: VIZ.textPrimary,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** PFC の内訳バー(積み上げ・セグメント間は 2px 空ける・直接ラベル付き) */
function PfcBar({
  protein,
  fat,
  carbs,
}: {
  protein: number;
  fat: number;
  carbs: number;
}) {
  const parts = [
    { key: "P", label: "タンパク質", value: protein, color: VIZ.series1 },
    { key: "F", label: "脂質", value: fat, color: VIZ.series2 },
    { key: "C", label: "炭水化物", value: carbs, color: VIZ.series3 },
  ];
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 2, height: 14 }}>
        {parts.map((p, i) => (
          <div
            key={p.key}
            style={{
              width: `${(p.value / total) * 100}%`,
              backgroundColor: p.color,
              // 端だけ丸める(データの端をベースラインに合わせる)
              borderTopLeftRadius: i === 0 ? 4 : 0,
              borderBottomLeftRadius: i === 0 ? 4 : 0,
              borderTopRightRadius: i === parts.length - 1 ? 4 : 0,
              borderBottomRightRadius: i === parts.length - 1 ? 4 : 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: p.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 15, color: VIZ.textSecondary }}>
              {p.label}
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: VIZ.textPrimary,
              }}
            >
              {formatNumber(p.value, 1)}g
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 体組成の数値タイル(記録がある項目だけ) */
function BodyStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        backgroundColor: "#f6f6f4",
        borderRadius: 12,
        padding: "10px 14px",
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 13, color: VIZ.textSecondary, marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{ fontSize: 20, fontWeight: 700, color: VIZ.textPrimary }}
      >
        {value}
      </div>
    </div>
  );
}

export default function DaySummaryCard({
  summary,
  innerRef,
}: {
  summary: DaySummary;
  /** html-to-image に渡すための ref */
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const { sections, meals, nutrition, body } = summary;

  // その日のトレーニング全体の合計(見出しの横に出す)
  const allLogs = sections.flatMap((s) => s.items);
  const allSets = allLogs.flatMap((log) => log.workout_sets ?? []);
  const dayVolume = totalVolume(allSets);

  const hasWorkout = allLogs.length > 0;
  const hasMeals = meals.length > 0;
  const bodyStats = body
    ? [
        body.weight_kg != null
          ? { label: "体重", value: `${formatNumber(Number(body.weight_kg), 1)}kg` }
          : null,
        body.body_fat_percent != null
          ? {
              label: "体脂肪率",
              value: `${formatNumber(Number(body.body_fat_percent), 1)}%`,
            }
          : null,
        body.skeletal_muscle_kg != null
          ? {
              label: "骨格筋量",
              value: `${formatNumber(Number(body.skeletal_muscle_kg), 1)}kg`,
            }
          : null,
        body.body_fat_mass_kg != null
          ? {
              label: "体脂肪量",
              value: `${formatNumber(Number(body.body_fat_mass_kg), 1)}kg`,
            }
          : null,
        body.bmr_kcal != null
          ? { label: "基礎代謝", value: `${formatNumber(Number(body.bmr_kcal))}kcal` }
          : null,
        body.body_water_l != null
          ? {
              label: "体水分量",
              value: `${formatNumber(Number(body.body_water_l), 1)}L`,
            }
          : null,
      ].filter((s): s is { label: string; value: string } => s !== null)
    : [];

  // 食事は「朝食 / 昼食 / 夕食 / 間食」ごとにまとめる(記録がある区分だけ)
  const mealGroups = MEAL_TYPE_ORDER.map((type) => ({
    type,
    items: meals.filter((m) => m.meal_type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      ref={innerRef}
      style={{
        width: CARD_WIDTH,
        boxSizing: "border-box",
        backgroundColor: "#ffffff",
        fontFamily: FONT_STACK,
        color: VIZ.textPrimary,
        padding: 32,
        // 縦長にしたいので最低限の高さを確保する
        minHeight: 800,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          borderBottom: `3px solid ${VIZ.textPrimary}`,
          paddingBottom: 18,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: VIZ.series1,
            letterSpacing: "0.14em",
            marginBottom: 8,
          }}
        >
          GYM BUDDY
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.25 }}>
          {formatDateLabel(summary.date)}
        </div>
      </div>

      {/* トレーニング(記録がある日だけ) */}
      {hasWorkout && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeading color={VIZ.series1} label="トレーニング" />
          <div
            style={{
              fontSize: 15,
              color: VIZ.textSecondary,
              marginBottom: 16,
            }}
          >
            {allLogs.length}種目 · {allSets.length}セット
            {dayVolume > 0 && ` · 総ボリューム ${formatNumber(dayVolume)}kg`}
          </div>

          {sections.map((section) => (
            <div key={section.group} style={{ marginBottom: 18 }}>
              {/* 部位の見出し。色ではなく文字と罫線で区別する */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  borderLeft: `4px solid ${VIZ.series1}`,
                  paddingLeft: 10,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 17, fontWeight: 700 }}>
                  {section.group}
                </span>
                <span style={{ fontSize: 13, color: VIZ.textSecondary }}>
                  {section.items.length}種目
                </span>
              </div>

              {section.items.map((log) => {
                const sets = sortSets(log.workout_sets ?? []);
                const weighted = hasWeight(sets);
                return (
                  <div
                    key={log.id}
                    style={{
                      padding: "8px 0 8px 14px",
                      borderBottom: `1px solid ${VIZ.grid}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 12,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 16, fontWeight: 600 }}>
                        {log.exercises?.name ?? "(削除された種目)"}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: VIZ.series1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {weighted
                          ? `最大 ${formatWeight(maxWeight(sets))}kg`
                          : `計 ${formatNumber(totalReps(sets))}回`}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: VIZ.textSecondary,
                        lineHeight: 1.6,
                      }}
                    >
                      {sets.length === 0
                        ? "セット未入力"
                        : sets
                            .map((s) =>
                              weighted
                                ? `${formatWeight(Number(s.weight_kg))}kg×${Number(s.reps)}回`
                                : `${Number(s.reps)}回`
                            )
                            .join("  /  ")}
                      {weighted &&
                        ` ・ 総ボリューム ${formatNumber(totalVolume(sets))}kg`}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* 食事(記録がある日だけ) */}
      {hasMeals && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeading color={VIZ.series2} label="食事" />
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700 }}>
              {formatNumber(nutrition.calories)}
            </span>
            <span style={{ fontSize: 16, color: VIZ.textSecondary }}>kcal</span>
            <span
              style={{
                fontSize: 14,
                color: VIZ.textSecondary,
                marginLeft: "auto",
              }}
            >
              {meals.length}品
            </span>
          </div>

          <PfcBar
            protein={nutrition.protein_g}
            fat={nutrition.fat_g}
            carbs={nutrition.carbs_g}
          />

          <div style={{ marginTop: 16 }}>
            {mealGroups.map((group) => (
              <div
                key={group.type}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "7px 0",
                  borderBottom: `1px solid ${VIZ.grid}`,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    width: 44,
                    flexShrink: 0,
                    fontWeight: 700,
                    color: VIZ.textSecondary,
                  }}
                >
                  {MEAL_TYPE_LABELS[group.type]}
                </span>
                <span style={{ color: VIZ.textPrimary, lineHeight: 1.6 }}>
                  {group.items.map((m) => m.food_name).join(" / ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* からだ(記録がある日だけ) */}
      {bodyStats.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeading color={VIZ.series3} label="からだ" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {bodyStats.map((stat) => (
              <BodyStat key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        </div>
      )}

      {/* フッター */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: 18,
          borderTop: `1px solid ${VIZ.grid}`,
          fontSize: 13,
          color: VIZ.muted,
          textAlign: "center",
        }}
      >
        #筋トレ記録 · gym-buddy
      </div>
    </div>
  );
}
