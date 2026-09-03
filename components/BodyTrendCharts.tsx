"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BodyLog } from "@/lib/types";
import { addDays, formatDate, parseDate } from "@/lib/bodyAnalysis";
import { VIZ } from "@/lib/viz";

/**
 * 体重・体脂肪率・骨格筋量の推移グラフ(スモールマルチプル)。
 *
 * 3 指標は単位もスケールも違うため、1 つのグラフに重ねる(2 軸グラフ)のではなく
 * 指標ごとに 1 系列のグラフを縦に並べている。1 系列なので凡例は置かず、
 * カード見出しの数値(最新値と期間内の増減)が直接ラベルの役割を果たす。
 * 数値はグラフ下の「記録一覧」でも確認できる(表ビュー)。
 */

export type TrendRange = "1m" | "3m" | "all";

export const TREND_RANGES: { value: TrendRange; label: string }[] = [
  { value: "1m", label: "1ヶ月" },
  { value: "3m", label: "3ヶ月" },
  { value: "all", label: "全期間" },
];

// dataviz スキルのリファレンスパレット(ライトモード)
const COLOR = {
  weight: VIZ.series1, // categorical slot 1 (blue)
  bodyFat: VIZ.series2, // categorical slot 2 (orange)
  muscle: VIZ.series3, // categorical slot 3 (aqua)
  surface: VIZ.surface,
  grid: VIZ.grid,
  axis: VIZ.axis,
  muted: VIZ.muted,
  textPrimary: VIZ.textPrimary,
  textSecondary: VIZ.textSecondary,
} as const;

type Point = { t: number; value: number; date: string };

type SeriesSpec = {
  key: "weight" | "bodyFat" | "muscle";
  title: string;
  unit: string;
  color: string;
  digits: number;
  /** 増加が望ましい指標かどうか(増減の色分けはせず、記号の向きだけに使う) */
  points: Point[];
};

const round = (n: number, digits: number) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

function rangeStart(range: TrendRange, today: string): string | null {
  if (range === "1m") return addDays(today, -30);
  if (range === "3m") return addDays(today, -90);
  return null;
}

function toPoint(date: string, value: number): Point {
  return { t: parseDate(date).getTime(), value, date };
}

function formatTick(t: number) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFullDate(t: number) {
  const d = new Date(t);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekday})`;
}

/**
 * Y 軸の目盛りをキリのよい数値にそろえる。
 * 体重・体脂肪率は 0 から始めても意味がないので 0 起点にはせず、
 * データの範囲に余白を足した区間をキリのよい刻み幅で割る。
 */
function niceScale(points: Point[]): {
  domain: [number, number];
  ticks: number[];
  decimals: number;
} {
  if (points.length === 0) {
    return { domain: [0, 1], ticks: [0, 1], decimals: 0 };
  }
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.12;
  const lo = min - pad;
  const hi = max + pad;

  // 目盛り 4 本を目安に、1 / 2 / 2.5 / 5 × 10^n の中から刻み幅を選ぶ
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) *
    mag;

  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 1000; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return {
    domain: [ticks[0], ticks[ticks.length - 1]],
    ticks,
    decimals: Number.isInteger(step) ? 0 : 1,
  };
}

function TrendTooltip({
  active,
  payload,
  unit,
  digits,
  color,
  title,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  unit: string;
  digits: number;
  color: string;
  title: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2 shadow-md">
      {/* 値が主役、系列名・日付は補助情報 */}
      <p
        className="text-base font-bold"
        style={{ color: COLOR.textPrimary }}
      >
        {point.value.toFixed(digits)}
        <span className="ml-0.5 text-xs font-normal">{unit}</span>
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: COLOR.textSecondary }}>
        <span
          aria-hidden
          className="inline-block h-0.5 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        {title}
      </p>
      <p className="text-xs" style={{ color: COLOR.muted }}>
        {formatFullDate(point.t)}
      </p>
    </div>
  );
}

function TrendCard({ spec }: { spec: SeriesSpec }) {
  const { points, title, unit, color, digits } = spec;
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const first = points.length > 0 ? points[0] : null;
  const delta =
    latest && first && points.length >= 2
      ? round(latest.value - first.value, digits)
      : null;
  // 記録が少ないときだけ各点にマーカーを出す(多いと点が潰れて読みにくいため)
  const showDots = points.length <= 15;
  const scale = niceScale(points);

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-end justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          <h3 className="text-sm font-semibold" style={{ color: COLOR.textSecondary }}>
            {title}
          </h3>
        </div>
        {latest && (
          <p className="leading-none" style={{ color: COLOR.textPrimary }}>
            <span className="text-2xl font-bold">
              {latest.value.toFixed(digits)}
            </span>
            <span className="ml-0.5 text-xs" style={{ color: COLOR.muted }}>
              {unit}
            </span>
          </p>
        )}
      </div>

      {latest && (
        <p className="mb-1 text-right text-xs" style={{ color: COLOR.muted }}>
          {delta != null && (
            <>
              期間内 {delta > 0 ? "+" : ""}
              {delta.toFixed(digits)}
              {unit} ·{" "}
            </>
          )}
          最終記録 {formatFullDate(latest.t)}
        </p>
      )}

      {points.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: COLOR.muted }}>
          この期間の記録がありません
        </p>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 10, bottom: 4, left: 0 }}
            >
              <CartesianGrid
                stroke={COLOR.grid}
                strokeWidth={1}
                vertical={false}
              />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={formatTick}
                tick={{ fill: COLOR.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: COLOR.axis }}
                minTickGap={24}
                height={20}
              />
              <YAxis
                domain={scale.domain}
                ticks={scale.ticks}
                tickFormatter={(v: number) => v.toFixed(scale.decimals)}
                tick={{ fill: COLOR.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={38}
              />
              <Tooltip
                cursor={{ stroke: COLOR.axis, strokeWidth: 1 }}
                content={
                  <TrendTooltip
                    unit={unit}
                    digits={digits}
                    color={color}
                    title={title}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
                dot={
                  showDots
                    ? {
                        r: 4,
                        fill: color,
                        stroke: COLOR.surface,
                        strokeWidth: 2,
                      }
                    : false
                }
                activeDot={{
                  r: 5,
                  fill: color,
                  stroke: COLOR.surface,
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function BodyTrendCharts({
  logs,
  range,
  onRangeChange,
}: {
  /** Phase 4 で統合した body_logs(1 日 1 件) */
  logs: BodyLog[];
  range: TrendRange;
  onRangeChange: (range: TrendRange) => void;
}) {
  const specs = useMemo<SeriesSpec[]>(() => {
    const today = formatDate(new Date());
    const from = rangeStart(range, today);
    const inRange = (date: string) => from == null || date >= from;

    const sorted = [...logs]
      .filter((log) => inRange(log.log_date))
      .sort((a, b) => a.log_date.localeCompare(b.log_date));

    const weightPoints = sorted
      .filter((log) => log.weight_kg != null)
      .map((log) => toPoint(log.log_date, Number(log.weight_kg)));

    const bodyFatPoints = sorted
      .filter((log) => log.body_fat_percent != null)
      .map((log) => toPoint(log.log_date, Number(log.body_fat_percent)));

    const musclePoints = sorted
      .filter((log) => log.skeletal_muscle_kg != null)
      .map((log) => toPoint(log.log_date, Number(log.skeletal_muscle_kg)));

    return [
      {
        key: "weight",
        title: "体重",
        unit: "kg",
        color: COLOR.weight,
        digits: 1,
        points: weightPoints,
      },
      {
        key: "bodyFat",
        title: "体脂肪率",
        unit: "%",
        color: COLOR.bodyFat,
        digits: 1,
        points: bodyFatPoints,
      },
      {
        key: "muscle",
        title: "骨格筋量",
        unit: "kg",
        color: COLOR.muscle,
        digits: 1,
        points: musclePoints,
      },
    ];
  }, [logs, range]);

  return (
    <div>
      {/* 期間フィルタ: グラフの上に 1 行でまとめ、3 つのグラフすべてに効かせる */}
      <div
        data-tour="body-range"
        className="mb-3 flex gap-1"
        role="group"
        aria-label="表示期間"
      >
        {TREND_RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onRangeChange(r.value)}
            aria-pressed={range === r.value}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
              range === r.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 active:bg-gray-200"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {specs.map((spec) => (
          <TrendCard key={spec.key} spec={spec} />
        ))}
      </div>
    </div>
  );
}
