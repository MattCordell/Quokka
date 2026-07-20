import type { FlatPlan } from '../plan/types';
import type { Bill, CategoryUsage, Period } from './types';
import { daysInPeriod } from './period';
import { priceFlatBill } from './flat';

/**
 * Manually-entered single-bill totals (PRD §5.2, Calibration Check). CL fields are `null` when
 * the household has no such circuit — distinct from a genuine 0 kWh (ADR-0002). Flat-rate only:
 * manual totals carry no timestamps, so there is no TOU equivalent.
 */
export interface ManualBillInput {
  period: Period;
  generalKwh: number;
  cl1Kwh: number | null;
  cl2Kwh: number | null;
  feedInKwh: number;
  actualCents: number;
}

export interface CalibrationResult {
  bill: Bill;
  actualCents: number;
  /** Calculated total minus actual, in cents (signed). */
  differenceCents: number;
  /** 100 * differenceCents / actualCents; null when actualCents is 0 (division undefined). */
  variancePct: number | null;
}

/**
 * Shapes manually-entered category totals into a CategoryUsage. A `null` CL leaves its
 * `mappedCategories` flag false, so `priceFlatBill`'s ADR-0002 gate renders it "not applicable";
 * entering a figure (including 0) marks that circuit as present. Solar is never gated. Manual
 * totals aren't interval reads, so `hasNonActualReads` is always false.
 */
export function manualCategoryUsage(input: ManualBillInput): CategoryUsage {
  return {
    kwhByCategory: {
      General: input.generalKwh,
      CL1: input.cl1Kwh ?? 0,
      CL2: input.cl2Kwh ?? 0,
      Generation: input.feedInKwh,
      Ignore: 0,
    },
    mappedCategories: {
      General: true,
      CL1: input.cl1Kwh !== null,
      CL2: input.cl2Kwh !== null,
      Generation: true,
      Ignore: false,
    },
    hasNonActualReads: false,
  };
}

/**
 * Runs manually-entered bill totals through the same flat-rate pricer used for interval data
 * (`priceFlatBill`) — no parallel calc path — and compares the result to the entered actual
 * total (PRD §7.5 Calibration Check).
 */
export function computeCalibration(plan: FlatPlan, input: ManualBillInput): CalibrationResult {
  const days = daysInPeriod(input.period);
  const bill = priceFlatBill(plan, manualCategoryUsage(input), days, input.period);
  const differenceCents = bill.totalCents - input.actualCents;
  const variancePct = input.actualCents === 0 ? null : (differenceCents / input.actualCents) * 100;
  return { bill, actualCents: input.actualCents, differenceCents, variancePct };
}
