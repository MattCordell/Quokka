import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan } from '../plan/types';
import type { Bill, CategoryUsage, Period } from './types';
import { daysInPeriod } from './period';
import { aggregateUsage } from './aggregate';
import { finalizeTotal, priceSupplyClSolar } from './common';

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
  const { supplyCents, cl1Applicable, cl1Cents, cl2Applicable, cl2Cents, solarCreditCents } =
    priceSupplyClSolar(plan, agg, days);

  const generalUsageCents = agg.kwhByCategory.General * plan.usage.generalRateCentsPerKwh;

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
