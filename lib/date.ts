/**
 * 日付まわりの共通ヘルパー。
 * YYYY-MM-DD の文字列をローカル日付として扱う(タイムゾーンずれ防止)。
 */

export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** Date を YYYY-MM-DD にする */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 今日の YYYY-MM-DD */
export function todayString(): string {
  return formatDate(new Date());
}

/** YYYY-MM-DD をローカル日付の Date にする */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 「2026年9月1日(火)」形式 */
export function formatDateLabel(dateStr: string): string {
  const date = parseDate(dateStr);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${
    WEEKDAY_LABELS[date.getDay()]
  })`;
}

/** 「9/1(火)」形式(狭い場所用) */
export function formatShortDateLabel(dateStr: string): string {
  const date = parseDate(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}(${
    WEEKDAY_LABELS[date.getDay()]
  })`;
}

/** YYYY-MM(月)を表す文字列を扱うヘルパー */
export type YearMonth = { year: number; month: number }; // month は 1-12

export function currentYearMonth(): YearMonth {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** その月の 1 日 / 末日の YYYY-MM-DD */
export function monthRange({ year, month }: YearMonth): {
  from: string;
  to: string;
} {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return { from: formatDate(first), to: formatDate(last) };
}

/**
 * カレンダーのマス目(日曜始まり・6 週 = 42 マス固定)。
 * 月をまたいでも高さが変わらないので、前月/翌月の切り替えで画面が跳ねない。
 */
export function calendarCells(ym: YearMonth): {
  date: string;
  day: number;
  inMonth: boolean;
}[] {
  const first = new Date(ym.year, ym.month - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      date: formatDate(d),
      day: d.getDate(),
      inMonth: d.getMonth() === ym.month - 1,
    };
  });
}
