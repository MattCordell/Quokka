import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan } from '../plan/types';
import type { Bill, CategoryUsage, Period } from './types';
import { daysInPeriod } from './period';
import { aggregateUsage } from './aggregate';

/**
 * The sole rounding site (ADR-0004): every Bill component stays full precision, and only the
 * final total is rounded here. To flip to per-line rounding later, replace the body with:
 *   charges.reduce((a, c) => a + Math.round(c), 0) - Math.round(credit)
 */
function finalizeTotal(charges: number[], credit: number): number {
  return Math.round(charges.reduce((a, c) => a + c, 0) - credit);
}

/**
 * Prices a flat-rate Plan against an already-aggregated CategoryUsage. `aggregateUsage` doesn't
 * depend on the plan's rates, so a caller pricing several plans over the same usage/mapping/
 * period (e.g. Compare's plan list) should aggregate once and call this per plan, rather than
 * re-aggregating per plan via computeFlatBill.
 */
export function priceFlatBill(
  plan: FlatPlan,
  agg: CategoryUsage,
  days: number,
  period: Period,
): Bill {
  // ADR-0002: a CLn charge (supply or usage) counts only if a register is mapped to CLn.
  const cl1Applicable = agg.mappedCategories.CL1;
  const cl2Applicable = agg.mappedCategories.CL2;

  const supplyCents =
    plan.supply.generalCentsPerDay * days +
    (cl1Applicable ? plan.supply.cl1CentsPerDay * days : 0) +
    (cl2Applicable ? plan.supply.cl2CentsPerDay * days : 0);

  const generalUsageCents = agg.kwhByCategory.General * plan.usage.generalRateCentsPerKwh;
  const cl1Cents = cl1Applicable
    ? agg.kwhByCategory.CL1 * plan.controlledLoad.cl1RateCentsPerKwh
    : 0;
  const cl2Cents = cl2Applicable
    ? agg.kwhByCategory.CL2 * plan.controlledLoad.cl2RateCentsPerKwh
    : 0;
  const solarCreditCents = agg.kwhByCategory.Generation * plan.feedInRateCentsPerKwh;

  const totalCents = finalizeTotal(
    [supplyCents, generalUsageCents, cl1Cents, cl2Cents],
    solarCreditCents,
  );

  return {
    planId: plan.id,
    period,
    daysInPeriod: days,
    supplyCents,
    generalUsageCents,
    cl1Applicable,
    cl1Cents,
    cl2Applicable,
    cl2Cents,
    solarCreditCents,
    totalCents,
    hasNonActualReads: agg.hasNonActualReads,
  };
}

/** Convenience one-shot: aggregates usage and prices a single plan in one call. */
export function computeFlatBill(
  plan: FlatPlan,
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): Bill {
  const days = daysInPeriod(period);
  const agg = aggregateUsage(usage, mapping, period);
  return priceFlatBill(plan, agg, days, period);
}
