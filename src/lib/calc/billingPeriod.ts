import { USAGE_CATEGORIES, type UsageCategory } from '../mapping/types';
import type { CategoryUsage, Period } from './types';
import { daysInPeriod } from './period';

/** ADR-0006: "annual" always normalises to a flat 365-day figure; leap years are not special-cased. */
export const ANNUAL_DAYS = 365;

/** The supply-charge day-count and scaling factor a "annual" Billing Period resolves to (ADR-0006). */
export interface AnnualWindow {
  /** The span actually summed: the most recent 365 days of `span`, or the whole span if shorter. */
  period: Period;
  /** daysInPeriod(period) (ADR-0005) — the real number of days the sampled data covers. */
  sampledDays: number;
  /** ANNUAL_DAYS / sampledDays, or exactly 1 when sampledDays >= ANNUAL_DAYS. */
  factor: number;
  extrapolated: boolean;
  /** The supply day-count to bill against — always ANNUAL_DAYS, regardless of extrapolation. */
  days: number;
}

function toUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoFromUtcMs(ms: number): string {
  const d = new Date(ms);
  return formatIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 1-based month's last day, via the "day 0 of the following month" trick (leap years fall out for free). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds `delta` calendar months to a 1-based (year, month), carrying across year boundaries. */
function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = month - 1 + delta;
  const y = year + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

/**
 * The 3 most recent complete calendar months in `span` (ADR-0009), or `null` if fewer than 3
 * exist. The most recent complete month is the month of `span.end` itself only if `end` is that
 * month's last day; otherwise it's the previous month (a partial trailing month is dropped). ISO
 * strings compare lexicographically (fixed-width YYYY-MM-DD), so the "1st before span.start"
 * check is a plain string comparison, matching dayInPeriod's style.
 */
export function resolveLastQuarter(span: Period): Period | null {
  const [endYear, endMonth, endDay] = span.end.split('-').map(Number);
  const endIsMonthEnd = endDay === lastDayOfMonth(endYear, endMonth);
  const lastCompleteMonth = endIsMonthEnd
    ? { year: endYear, month: endMonth }
    : addMonths(endYear, endMonth, -1);

  const quarterStartMonth = addMonths(lastCompleteMonth.year, lastCompleteMonth.month, -2);
  const quarterStart = formatIso(quarterStartMonth.year, quarterStartMonth.month, 1);
  if (quarterStart < span.start) return null;

  const quarterEndDay = lastDayOfMonth(lastCompleteMonth.year, lastCompleteMonth.month);
  const quarterEnd = formatIso(lastCompleteMonth.year, lastCompleteMonth.month, quarterEndDay);

  return { start: quarterStart, end: quarterEnd };
}

/**
 * Resolves the "annual" Billing Period (ADR-0006): >= 365 days of data sums only the most recent
 * 365 days (a multi-year file must never report a multi-year total, `factor: 1`, not
 * extrapolated); fewer than 365 days sums the whole span and scales it up by `365 /
 * sampledDays`, flagged `extrapolated`. `days` (the supply day-count to bill against) is always
 * ANNUAL_DAYS, so the caller doesn't need to branch on `extrapolated` to price supply charges.
 */
export function resolveAnnual(span: Period): AnnualWindow {
  const spanDays = daysInPeriod(span);
  if (spanDays >= ANNUAL_DAYS) {
    const period = {
      start: isoFromUtcMs(toUtcMs(span.end) - (ANNUAL_DAYS - 1) * 86_400_000),
      end: span.end,
    };
    return { period, sampledDays: ANNUAL_DAYS, factor: 1, extrapolated: false, days: ANNUAL_DAYS };
  }
  return {
    period: span,
    sampledDays: spanDays,
    factor: ANNUAL_DAYS / spanDays,
    extrapolated: true,
    days: ANNUAL_DAYS,
  };
}

/**
 * Scales `kwhByCategory` by `factor` (ADR-0006's annual extrapolation), leaving every other field
 * untouched: `mappedCategories`, `hasNonActualReads`, `nonActualDayCount` and `daysWithData`
 * describe the *sampled* data, not the projected year, and scaling them would misrepresent data
 * coverage as if the extrapolated year had actually been measured.
 */
export function scaleCategoryUsage(agg: CategoryUsage, factor: number): CategoryUsage {
  const kwhByCategory = Object.fromEntries(
    USAGE_CATEGORIES.map((category) => [category, agg.kwhByCategory[category] * factor]),
  ) as Record<UsageCategory, number>;

  return { ...agg, kwhByCategory };
}

/**
 * Scales every weekly General slot by `factor`. Because a TOU band's summed kWh is a linear sum
 * of slots (tou.ts's priceTouBill), scaling every slot scales each band by exactly `factor` and
 * leaves band *proportions* — the usage shape — intact, so this is the one change needed to
 * extrapolate a TOU bill without a second pricing path (ADR-0006).
 */
export function scaleGeneralWeek(week: Map<string, number>, factor: number): Map<string, number> {
  const scaled = new Map<string, number>();
  for (const [key, kwh] of week) {
    scaled.set(key, kwh * factor);
  }
  return scaled;
}
