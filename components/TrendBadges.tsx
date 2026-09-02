"use client";

import { VIZ } from "@/lib/viz";
import { formatShortDateLabel } from "@/lib/date";
import {
  formatNumber,
  formatWeight,
  type MetricComparison,
  type WorkoutComparison,
} from "@/lib/workoutStats";

/**
 * 同じ種目の「前回の記録」と比べた伸び / 落ちの表示。
 *
 * 判定は「その種目の最大重量」と「総ボリューム(重量 × 回数の合計)」の両方。
 * 伸びは青、落ちは赤にするが、色だけに頼らないよう ↑ ↓ の矢印と
 * 「+2.5kg」のような差分の数値を必ず併記している。
 * 前回記録が無い種目には色を付けない。
 */

const STYLE: Record<
  MetricComparison["direction"],
  { color: string; background: string; arrow: string; word: string }
> = {
  up: { color: VIZ.up, background: VIZ.upTint, arrow: "↑", word: "増" },
  down: { color: VIZ.down, background: VIZ.downTint, arrow: "↓", word: "減" },
  same: { color: VIZ.textSecondary, background: "#f3f3f1", arrow: "→", word: "変化なし" },
};

function Badge({
  label,
  value,
  unit,
  comparison,
  format,
}: {
  label: string;
  value: number;
  unit: string;
  comparison: MetricComparison;
  format: (n: number) => string;
}) {
  const style = STYLE[comparison.direction];
  const sign = comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : "±";
  const deltaText =
    comparison.direction === "same"
      ? "前回と同じ"
      : `前回比 ${sign}${format(Math.abs(comparison.delta))}${unit}`;

  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-lg px-2 py-1 text-xs"
      style={{ backgroundColor: style.background, color: style.color }}
    >
      <span className="font-normal opacity-80">{label}</span>
      <span className="font-bold tabular-nums">
        {format(value)}
        {unit}
      </span>
      <span aria-hidden className="font-bold">
        {style.arrow}
      </span>
      <span className="tabular-nums">{deltaText}</span>
      <span className="sr-only">({style.word})</span>
    </span>
  );
}

export default function TrendBadges({
  comparison,
  maxWeight,
  totalVolume,
  weightless,
}: {
  /** 前回記録が無ければ null(色を付けずに「前回記録なし」と出す) */
  comparison: WorkoutComparison | null;
  maxWeight: number;
  totalVolume: number;
  /** 重量が 1 セットも入っていない記録(自重種目 / 重量未入力) */
  weightless?: boolean;
}) {
  // 重量の入っていない記録で「最大 0kg」と出すと誤解を招くので比較自体を出さない
  if (weightless) {
    return (
      <p className="mt-1.5 text-xs" style={{ color: VIZ.muted }}>
        重量が未入力です(自重種目ならそのままで OK)
      </p>
    );
  }

  if (!comparison) {
    return (
      <p className="mt-1.5 text-xs" style={{ color: VIZ.muted }}>
        最大 {formatWeight(maxWeight)}kg ・ ボリューム{" "}
        {formatNumber(totalVolume)}kg(前回の記録なし)
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1">
        <Badge
          label="最大"
          value={maxWeight}
          unit="kg"
          format={formatWeight}
          comparison={comparison.maxWeight}
        />
        <Badge
          label="ボリューム"
          value={totalVolume}
          unit="kg"
          format={(n) => formatNumber(n)}
          comparison={comparison.totalVolume}
        />
      </div>
      <p className="mt-1 text-xs" style={{ color: VIZ.muted }}>
        前回 {formatShortDateLabel(comparison.previousDate)} と比較
      </p>
    </div>
  );
}
