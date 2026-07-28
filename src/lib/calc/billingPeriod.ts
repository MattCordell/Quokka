import { USAGE_CATEGORIES, type UsageCategory } from '../mapping/types';
import type { TouDay } from '../plan/types';
import { CalcError, type CategoryUsage, type Period } from './types';
import { daysInPeriod, formatIso, isoFromUtcMs, toUtcMs } from './period';
import { parseWeekSlotKey } from './tou';

/** ADR-0006: "annual" always normalises to a flat 365-day figure; leap years are not special-cased. */
export const ANNUAL_DAYS = 365;

/** A day-of-week's expected share of a flat 365-day year (not calendar-aligned; see ANNUAL_DAYS). */
const DOW_ANNUAL_OCCURRENCES = ANNUAL_DAYS / 7;

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
 *
 * This only resolves calendar bounds — it doesn't know whether the data actually has readings
 * inside that window (a resolved quarter can straddle a real interior gap, e.g. a file with
 * Jan-Mar and Jul data but nothing between). Callers must additionally verify data presence for
 * each of the 3 months (see `quarterMonthPeriods`) before trusting this as "available".
 */
export function resolveLastQuarter(span: Period): Period | null {
  if (span.end < span.start) {
    throw new CalcError(`Span end (${span.end}) is before start (${span.start})`);
  }

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

/** Splits a 3-calendar-month quarter (as resolved by `resolveLastQuarter`) into its 3 months. */
export function quarterMonthPeriods(quarter: Period): [Period, Period, Period] {
  const [year, month] = quarter.start.split('-').map(Number);
  const months = [0, 1, 2].map((offset) => {
    const { year: y, month: m } = addMonths(year, month, offset);
    return { start: formatIso(y, m, 1), end: formatIso(y, m, lastDayOfMonth(y, m)) };
  });
  return [months[0], months[1], months[2]];
}

/**
 * The candidate window for the "annual" Billing Period (ADR-0006): the most recent 365 calendar
 * days of `span`, or the whole span if it's shorter. Calendar-only — like `resolveLastQuarter`,
 * it doesn't know how much of that window actually has data; `scaleCategoryUsage`/
 * `scaleGeneralWeek` derive the real per-category/per-day-of-week scaling from the aggregation
 * over this period, not from this function's calendar span.
 */
export function resolveAnnualPeriod(span: Period): Period {
  const spanDays = daysInPeriod(span);
  if (spanDays >= ANNUAL_DAYS) {
    return {
      start: isoFromUtcMs(toUtcMs(span.end) - (ANNUAL_DAYS - 1) * 86_400_000),
      end: span.end,
    };
  }
  return span;
}

/**
 * `expected / sampled`, or exactly 1 when `sampled` already meets or exceeds `expected` (real,
 * complete coverage is never scaled down) or when there's no data at all to scale (division by
 * zero would be meaningless — a zero-sample dimension has nothing for a factor to multiply).
 */
function coverageFactor(sampled: number, expected: number): number {
  return sampled > 0 && sampled < expected ? expected / sampled : 1;
}

/**
 * Scales `kwhByCategory` for annual extrapolation (ADR-0006), one category at a time: each
 * category's factor is `ANNUAL_DAYS / daysWithData[category]`, not one blanket factor across all
 * categories. This matters because mapped categories don't always share the same coverage — a
 * solar Generation register can read every day of the window while General has an interior gap
 * (meter swap, partial re-export) — so scaling every category by the same number would either
 * under-correct the gappy category or over-inflate the complete one. Every other field
 * (`mappedCategories`, `hasNonActualReads`, `nonActualDayCount`, `daysWithData` itself) is left
 * untouched — they describe the *sampled* data, not the projected year.
 */
export function scaleCategoryUsage(agg: CategoryUsage): CategoryUsage {
  const kwhByCategory = Object.fromEntries(
    USAGE_CATEGORIES.map((category) => [
      category,
      agg.kwhByCategory[category] * coverageFactor(agg.daysWithData[category], ANNUAL_DAYS),
    ]),
  ) as Record<UsageCategory, number>;

  return { ...agg, kwhByCategory };
}

/**
 * Scales every weekly General slot for annual extrapolation, one day-of-week at a time: each
 * day-of-week's factor is `(ANNUAL_DAYS / 7) / daysByDow[day]` (its own actual sample size, from
 * `countGeneralDaysByDow`), not one blanket factor applied to the whole map. A single global
 * factor (raw total scaled by `ANNUAL_DAYS / sampledDays`) silently mis-weights any sample that
 * isn't an exact multiple of 7 days: a day-of-week sampled fewer times than others would be
 * under-represented in the projected year, and — worse — a day-of-week entirely absent from the
 * sample (e.g. a 2-day sample covering only a Tuesday and Wednesday) would project as exactly
 * zero kWh for every TOU band scheduled on it, silently mis-ranking a plan whose cheap band falls
 * on an unsampled day. Per-day-of-week scaling fixes the representable case (uneven but non-zero
 * coverage); a day-of-week with zero samples has no key in `week` at all and stays absent here
 * too — no scaling factor can manufacture data that was never measured. Callers must disclose
 * that gap explicitly (see `missingDaysOfWeek`) rather than let a silent zero read as measured.
 */
export function scaleGeneralWeek(
  week: Map<string, number>,
  daysByDow: Record<TouDay, number>,
): Map<string, number> {
  const scaled = new Map<string, number>();
  for (const [key, kwh] of week) {
    const { day } = parseWeekSlotKey(key);
    scaled.set(key, kwh * coverageFactor(daysByDow[day], DOW_ANNUAL_OCCURRENCES));
  }
  return scaled;
}

/**
 * The day(s) of the week with zero General samples in `daysByDow` — days no amount of scaling
 * can project, because none were ever measured. Empty when the sample covers every day of the
 * week at least once.
 */
export function missingDaysOfWeek(daysByDow: Record<TouDay, number>): TouDay[] {
  return (Object.keys(daysByDow) as TouDay[]).filter((day) => daysByDow[day] === 0);
}

/**
 * Describes the annual extrapolation applied to General usage (ADR-0006), or `null` if General's
 * own day-coverage already meets `ANNUAL_DAYS` (no scaling needed — either a genuine full year,
 * or the >= 365-calendar-day window happened to have no gaps). General is the category checked
 * here because it's priced on every plan and is usually the dominant charge; `scaleCategoryUsage`
 * itself still corrects every other mapped category independently using its own coverage.
 */
export function describeExtrapolation(
  agg: CategoryUsage,
): { factor: number; sampledDays: number } | null {
  const sampledDays = agg.daysWithData.General;
  const factor = coverageFactor(sampledDays, ANNUAL_DAYS);
  return factor !== 1 ? { factor, sampledDays } : null;
}
