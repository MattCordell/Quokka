import type { UsageCategory } from '../mapping/types';
import type { DiscountLine } from './discount';

export class CalcError extends Error {}

/** ISO YYYY-MM-DD, inclusive of both endpoints (ADR-0005). */
export interface Period {
  start: string;
  end: string;
}

/**
 * Per-category kWh aggregation over a Period (ADR-0003, ADR-0011). `nonActualDayCount` counts
 * distinct in-period days (deduped across registers, per ADR-0003) where any counted interval
 * (non-Ignore/unmapped register, including Generation) resolved to a non-'A' quality flag — one
 * non-'A' interval flags the whole day.
 */
export interface CategoryUsage {
  kwhByCategory: Record<UsageCategory, number>;
  /** Whether any register is mapped to this category, independent of its kWh (ADR-0002). */
  mappedCategories: Record<UsageCategory, boolean>;
  /** Any counted interval (non-Ignore register, in period) resolved to a non-'A' flag. */
  hasNonActualReads: boolean;
  nonActualDayCount: number;
  /**
   * Per-category distinct in-period days (deduped within that category's mapped, non-Ignore
   * registers) with any data at all, regardless of quality flag — a gap-coverage count, not a
   * quality count. Kept per-category (not unioned across categories) because one fully-covered
   * register must never mask a gap in another: e.g. a solar Generation register reading every
   * day of the window would otherwise hide a 165-day gap in the General register that shares the
   * same period, understating the General charge — the dominant line on every bill — with no
   * disclosure. Compared against `daysInPeriod` per category to surface that shortfall, and
   * against `ANNUAL_DAYS` to decide how much (if any) annual extrapolation a category needs.
   */
  daysWithData: Record<UsageCategory, number>;
}

/** One TOU band's contribution to generalUsageCents. Full precision (ADR-0004). */
export interface BandCharge {
  label: string;
  kwh: number;
  rateCentsPerKwh: number;
  cents: number;
}

/** Which discount stage a total reflects (ADR-0007): guaranteed only, or guaranteed + conditional. */
export type TotalBasis = 'guaranteed' | 'bestCase';

/**
 * The two rounded totals a Bill produces (ADR-0007) plus the full-precision base and discount
 * amounts they're derived from. Both totals round independently from `preDiscountCents`
 * (ADR-0004) — `bestCaseTotalCents` is never `guaranteedTotalCents` minus a rounded conditional
 * amount, which would compound rounding error.
 */
export interface BillTotals {
  preDiscountCents: number;
  guaranteedDiscountCents: number;
  conditionalDiscountCents: number;
  guaranteedTotalCents: number;
  bestCaseTotalCents: number;
}

/**
 * The computed result for one Plan over one Period. Every field except the two totals in
 * `BillTotals` is full precision (ADR-0004). `cl1Applicable`/`cl2Applicable` distinguish "not
 * applicable" (no mapped register, ADR-0002) from a genuine $0 charge. `bands` is present only
 * for a TOU bill (undefined for flat-rate); when present, `generalUsageCents` equals the sum of
 * every band's `cents`. With `discountLines: []` (no discounts), `guaranteedTotalCents ===
 * bestCaseTotalCents === Math.round(preDiscountCents)` — the old `totalCents` behaviour.
 */
export interface Bill extends BillTotals {
  planId: string;
  period: Period;
  daysInPeriod: number;

  supplyCents: number;
  generalUsageCents: number;
  bands?: BandCharge[];
  cl1Applicable: boolean;
  cl1Cents: number;
  cl2Applicable: boolean;
  cl2Cents: number;
  solarCreditCents: number;

  discountLines: DiscountLine[];

  hasNonActualReads: boolean;
  nonActualDayCount: number;

  /**
   * Non-null when this Bill was priced under ADR-0006 annual extrapolation: `factor` is the
   * General **category**'s scaling factor (ANNUAL_DAYS / sampledDays), `sampledDays` the actual
   * General-category day-coverage it was derived from — the same descriptor is passed to both a
   * flat and a TOU bill priced over the same period, so it's comparable across plan types. It
   * describes that category-level projection only: a TOU bill's `bands` are scaled per-day-of-week
   * (`scaleGeneralWeek`), a different — and, for an uneven sample, different-valued — factor per
   * day-of-week, so `factor`/`sampledDays` must not be read as "the number `bands` was multiplied
   * by". `null` for a measured bill (including a >=365-day annual window with full coverage, where
   * nothing was scaled). Carried on the Bill itself — not left as a caller-local flag — so any
   * future consumer (an export, a persisted comparison, `computeCalibration`) can tell a projected
   * figure from a measured one without re-deriving it from UI state (ADR-0013: the engine is the
   * framework-agnostic source of truth for billing math, extrapolation included).
   */
  extrapolation: { factor: number; sampledDays: number } | null;
}
