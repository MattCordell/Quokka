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

/**
 * The computed result for one flat-rate Plan over one Period. Every field except
 * `totalCents` is full precision (ADR-0004) — `totalCents` is the only rounded value.
 * `cl1Applicable`/`cl2Applicable` distinguish "not applicable" (no mapped register,
 * ADR-0002) from a genuine $0 charge.
 */
export interface Bill {
  planId: string;
  period: Period;
  daysInPeriod: number;

  supplyCents: number;
  generalUsageCents: number;
  cl1Applicable: boolean;
  cl1Cents: number;
  cl2Applicable: boolean;
  cl2Cents: number;
  solarCreditCents: number;

  totalCents: number;
  hasNonActualReads: boolean;
}
