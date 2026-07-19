import type { UsageCategory } from '../mapping/types';

export class CalcError extends Error {}

/** ISO YYYY-MM-DD, inclusive of both endpoints (ADR-0005). */
export interface Period {
  start: string;
  end: string;
}

/** Per-category kWh aggregation over a Period (ADR-0003, ADR-0011). */
export interface CategoryUsage {
  kwhByCategory: Record<UsageCategory, number>;
  /** Whether any register is mapped to this category, independent of its kWh (ADR-0002). */
  mappedCategories: Record<UsageCategory, boolean>;
  /** Any counted interval (non-Ignore register, in period) resolved to a non-'A' flag. */
  hasNonActualReads: boolean;
}

/** One TOU band's contribution to generalUsageCents. Full precision (ADR-0004). */
export interface BandCharge {
  label: string;
  kwh: number;
  rateCentsPerKwh: number;
  cents: number;
}

/**
 * The computed result for one Plan over one Period. Every field except `totalCents` is full
 * precision (ADR-0004) — `totalCents` is the only rounded value. `cl1Applicable`/
 * `cl2Applicable` distinguish "not applicable" (no mapped register, ADR-0002) from a genuine
 * $0 charge. `bands` is present only for a TOU bill (undefined for flat-rate); when present,
 * `generalUsageCents` equals the sum of every band's `cents`.
 */
export interface Bill {
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

  totalCents: number;
  hasNonActualReads: boolean;
}
