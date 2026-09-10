"use client";

import { StickyNote } from "lucide-react";
import { VIZ } from "@/lib/viz";
import { formatDateLabel } from "@/lib/date";
import {
  formatNumber,
  formatWeight,
  hasMemo,
  hasWeight,
  maxWeight,
  memoText,
  sortSets,
  totalReps,
  totalVolume,
} from "@/lib/workoutStats";
import type { DaySummary, MealType, WorkoutSet } from "@/lib/types";

/**
 * 1 日のサマリーを 1 枚の縦長画像にするためのカード。
 *
 * ■ html-to-image に渡す前提での作りかた
 * - スタイルはすべてインラインの 16 進カラーで書く。
 *   Tailwind v4 の色は oklch() なので、DOM を SVG に写して描画する
 *   html-to-image では環境によって色が落ちることがある。
 * - グラデーション・影・画像は使わない(書き出し環境によって落ちるため)。
 *   立体感は「濃い面」「薄い面」「余白」だけで作る。
 * - フォントは端末に必ずある日本語フォントだけを指定する(Web フォントを
 *   読み込むと、書き出し時にフォントが間に合わず豆腐になることがある)。
 *
 * ■ 配色(dataviz スキルの指針)
 * - カテゴリカルは lib/viz.ts の固定スロット順(青=トレーニング / 橙=食事 /
 *   アクア=からだ)だけを使い、順番を入れ替えない。
 * - 部位は 8 区分あるためカテゴリカル色は割り当てず、見出しの文字で区別する
 *   (9 色目を作らない・色だけに意味を持たせない)。
 * - 数値やラベルには系列色を使わず、必ず文字色(ink)で書く。
 *   色は隣に置いたマーク(帯・ドット)だけが持つ。
 * - セットの帯は「1 系列の量」なので単色 + 薄い同色のトラック。
 *   データ側の端だけ丸め、始点は基準線にそろえる。
 */

/** 端末にある日本語フォントだけで組む(iOS Safari / Android / PC 共通) */
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

/** 書き出す画像の幅(px)。実際の PNG は pixelRatio 2 で 2 倍になる */
export const CARD_WIDTH = 640;

/** 見出し帯の地の色(濃い面)と、その上に置くタイルの面 */
const INK = "#111110";
const INK_TILE = "#232320";
const INK_TEXT = "#ffffff";
const INK_MUTED = "#a3a29c";

/** 本文側の薄い面(カードの地) */
const SURFACE_SOFT = "#f7f7f4";

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
  snack: "間食",
};

const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/** 見出し帯に並べる数値 */
type Headline = { label: string; value: string; unit?: string };

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

/**
 * セット 1 つぶんの行。
 *
 * 以前は「50kg×3回 / 40kg×5回 / …」と 1 行に詰めていたが、
 * セットが増えるほど折り返して読めなくなるため 1 セット 1 行にした。
 * 右の帯は、その種目の中でいちばん大きいセットを 100% とした量の目安。
 */
function SetRow({
  index,
  set,
  weighted,
  ratio,
  compact,
}: {
  index: number;
  set: WorkoutSet;
  /** その種目に重量が入っているか(自重種目なら回数だけで組む) */
  weighted: boolean;
  /** 帯の長さ(0〜1) */
  ratio: number;
  /** 2 列に組む日は、幅が半分になるので列を減らす */
  compact: boolean;
}) {
  const weight = Number(set.weight_kg);
  const reps = Number(set.reps);
  const volume = weight * reps;
  const barWidth = compact ? 46 : 116;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 8 : 10,
        padding: compact ? "3px 0" : "6px 0",
      }}
    >
      <span
        style={{
          width: compact ? 30 : 36,
          flexShrink: 0,
          fontSize: compact ? 11 : 12,
          fontWeight: 700,
          color: VIZ.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {index + 1}set
      </span>

      {/* 数値が主役。帯はあくまで補助なので、幅は数値側に多く渡す */}
      <span
        style={{
          flex: 1,
          fontSize: compact ? 14 : 16,
          fontWeight: 600,
          color: VIZ.textPrimary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {weighted ? `${formatWeight(weight)}kg × ${reps}回` : `${reps}回`}
      </span>

      {/* 量の目安。トラックは同じ色の薄い段(dataviz のメーター指定) */}
      <div
        style={{
          width: barWidth,
          flexShrink: 0,
          height: compact ? 4 : 5,
          borderRadius: 4,
          backgroundColor: VIZ.series1Tint,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(2, Math.round(ratio * 100))}%`,
            height: compact ? 4 : 5,
            // 始点は基準線にそろえ、データ側の端だけ丸める
            borderRadius: "0 4px 4px 0",
            backgroundColor: VIZ.series1,
          }}
        />
      </div>

      {/* 重量がある種目だけ、そのセットのボリュームを出す。
          自重種目でも枠は残して、行ごとに列がずれないようにする。
          2 列に組む日は幅が足りないので、この列は出さない
          (種目ごとの合計はカードの下に出ている) */}
      {!compact && (
        <span
          style={{
            width: 66,
            flexShrink: 0,
            textAlign: "right",
            fontSize: 13,
            color: VIZ.textSecondary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {weighted ? `${formatNumber(volume)}kg` : ""}
        </span>
      )}
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
        backgroundColor: SURFACE_SOFT,
        borderRadius: 12,
        padding: "12px 16px",
        minWidth: 124,
      }}
    >
      <div style={{ fontSize: 13, color: VIZ.textSecondary, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, color: VIZ.textPrimary }}>
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

  // その日のトレーニング全体の合計(見出し帯に出す)
  const allLogs = sections.flatMap((s) => s.items);
  const allSets = allLogs.flatMap((log) => log.workout_sets ?? []);
  const dayVolume = totalVolume(allSets);

  const hasWorkout = allLogs.length > 0;

  /**
   * 種目が多い日は、種目カードを 2 列に組む。
   *
   * 1 列のままだと画像が縦に伸びすぎて、スマホの写真アプリで
   * 1 画面に収まらなくなる(9 種目で縦 2,600px を超えていた)。
   * 2 列にすると、同じ内容のまま縦がおよそ半分になる。
   */
  const compact = allLogs.length >= 4;
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

  /**
   * 見出し帯に並べる 3 つの数値。
   * その日に何を記録したかで中身が変わる(トレーニングが主役、無ければ食事)。
   */
  const headlines: Headline[] = [];
  if (hasWorkout) {
    headlines.push({ label: "種目", value: String(allLogs.length) });
    headlines.push({ label: "セット", value: String(allSets.length) });
    if (dayVolume > 0) {
      headlines.push({
        label: "総ボリューム",
        value: formatNumber(dayVolume),
        unit: "kg",
      });
    } else {
      headlines.push({
        label: "総レップ",
        value: formatNumber(totalReps(allSets)),
        unit: "回",
      });
    }
  } else if (hasMeals) {
    headlines.push({
      label: "カロリー",
      value: formatNumber(nutrition.calories),
      unit: "kcal",
    });
    headlines.push({
      label: "タンパク質",
      value: formatNumber(nutrition.protein_g, 1),
      unit: "g",
    });
    headlines.push({ label: "品目", value: String(meals.length) });
  } else {
    for (const stat of bodyStats.slice(0, 3)) {
      headlines.push({ label: stat.label, value: stat.value });
    }
  }

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
        minHeight: 800,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── 見出し帯(濃い面)──────────────────────── */}
      <div
        style={{
          backgroundColor: INK,
          padding: compact ? "26px 26px 22px" : "30px 32px 26px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: INK_MUTED,
              letterSpacing: "0.18em",
            }}
          >
            GYM BUDDY
          </span>
          <span style={{ fontSize: 13, color: INK_MUTED }}>#筋トレ記録</span>
        </div>

        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1.2,
            color: INK_TEXT,
          }}
        >
          {formatDateLabel(summary.date)}
        </div>

        {headlines.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {headlines.map((stat) => (
              <div
                key={stat.label}
                style={{
                  flex: 1,
                  backgroundColor: INK_TILE,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{ fontSize: 12, color: INK_MUTED, marginBottom: 5 }}
                >
                  {stat.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                  {/* 大きい数値には tabular-nums を使わない(字間が空いて見えるため) */}
                  <span
                    style={{ fontSize: 24, fontWeight: 700, color: INK_TEXT }}
                  >
                    {stat.value}
                  </span>
                  {stat.unit && (
                    <span style={{ fontSize: 13, color: INK_MUTED }}>
                      {stat.unit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 本文 ─────────────────────────────── */}
      <div style={{ flex: 1, padding: compact ? "22px 26px 0" : "26px 32px 0" }}>
        {/* トレーニング(記録がある日だけ) */}
        {hasWorkout && (
          <div style={{ marginBottom: 26 }}>
            <SectionHeading color={VIZ.series1} label="トレーニング" />

            {sections.map((section) => (
              <div key={section.group} style={{ marginBottom: compact ? 12 : 18 }}>
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

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "stretch",
                  }}
                >
                  {section.items.map((log) => {
                  const sets = sortSets(log.workout_sets ?? []);
                  const weighted = hasWeight(sets);
                  // 帯の基準は、その種目の中でいちばん大きいセット
                  const values = sets.map((s) =>
                    weighted
                      ? Number(s.weight_kg) * Number(s.reps)
                      : Number(s.reps)
                  );
                  const peak = Math.max(1, ...values);

                  return (
                    <div
                      key={log.id}
                      style={{
                        // 2 列に組む日は半分の幅。gap のぶんだけ引いておく
                        width: compact ? "calc(50% - 4px)" : "100%",
                        boxSizing: "border-box",
                        backgroundColor: SURFACE_SOFT,
                        borderRadius: 14,
                        padding: compact ? "12px 14px" : "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: compact ? 15 : 17,
                            fontWeight: 700,
                            lineHeight: 1.35,
                          }}
                        >
                          {log.exercises?.name ?? "(削除された種目)"}
                        </span>
                        {/* 数値は文字色で書き、色は面(タグの地)だけが持つ */}
                        <span
                          style={{
                            flexShrink: 0,
                            backgroundColor: VIZ.series1Tint,
                            color: VIZ.textPrimary,
                            borderRadius: 999,
                            padding: compact ? "3px 9px" : "4px 12px",
                            fontSize: compact ? 12 : 13,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {weighted
                            ? `最大 ${formatWeight(maxWeight(sets))}kg`
                            : `計 ${formatNumber(totalReps(sets))}回`}
                        </span>
                      </div>

                      {sets.length === 0 ? (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 14,
                            color: VIZ.muted,
                          }}
                        >
                          セット未入力
                        </div>
                      ) : (
                        <div style={{ marginTop: compact ? 6 : 8, marginBottom: compact ? 8 : 10 }}>
                          {sets.map((set, i) => (
                            <SetRow
                              key={set.id}
                              index={i}
                              set={set}
                              weighted={weighted}
                              ratio={values[i] / peak}
                              compact={compact}
                            />
                          ))}
                        </div>
                      )}

                      {/* その種目の合計 */}
                      <div
                        style={{
                          paddingTop: compact ? 8 : 10,
                          borderTop: `1px solid ${VIZ.grid}`,
                          fontSize: compact ? 12 : 13,
                          color: VIZ.textSecondary,
                        }}
                      >
                        {sets.length}セット
                        {weighted
                          ? ` · 総ボリューム ${formatNumber(totalVolume(sets))}kg`
                          : ` · 計 ${formatNumber(totalReps(sets))}回`}
                      </div>

                      {/* その種目のメモ(あれば) */}
                      {hasMemo(log.memo) && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            marginTop: compact ? 8 : 10,
                            paddingLeft: 10,
                            borderLeft: `3px solid ${VIZ.axis}`,
                            fontSize: compact ? 12 : 13,
                            lineHeight: 1.6,
                            color: VIZ.textSecondary,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          <StickyNote
                            aria-hidden
                            size={14}
                            strokeWidth={2}
                            style={{ flexShrink: 0, marginTop: 2 }}
                          />
                          <span>{memoText(log.memo)}</span>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 食事(記録がある日だけ) */}
        {hasMeals && (
          <div style={{ marginBottom: 26 }}>
            <SectionHeading color={VIZ.series2} label="食事" />
            <div
              style={{
                backgroundColor: SURFACE_SOFT,
                borderRadius: 14,
                padding: "16px 18px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700 }}>
                  {formatNumber(nutrition.calories)}
                </span>
                <span style={{ fontSize: 16, color: VIZ.textSecondary }}>
                  kcal
                </span>
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
            </div>

            <div style={{ marginTop: 12 }}>
              {mealGroups.map((group) => (
                <div
                  key={group.type}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 2px",
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
          <div style={{ marginBottom: 26 }}>
            <SectionHeading color={VIZ.series3} label="からだ" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {bodyStats.map((stat) => (
                <BodyStat key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── フッター ─────────────────────────── */}
      <div
        style={{
          margin: compact ? "0 26px" : "0 32px",
          padding: compact ? "14px 0 20px" : "16px 0 26px",
          borderTop: `1px solid ${VIZ.grid}`,
          fontSize: 13,
          color: VIZ.muted,
          textAlign: "center",
        }}
      >
        gym-buddy
      </div>
    </div>
  );
}
