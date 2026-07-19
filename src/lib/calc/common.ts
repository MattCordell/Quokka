import type { Plan } from '../plan/types';
import type { CategoryUsage } from './types';

/**
 * The sole rounding site (ADR-0004): every Bill component stays full precision, and only the
 * final total is rounded here. To flip to per-line rounding later, replace the body with:
 *   charges.reduce((a, c) => a + Math.round(c), 0) - Math.round(credit)
 */
export function finalizeTotal(charges: number[], credit: number): number {
  return Math.round(charges.reduce((a, c) => a + c, 0) - credit);
}

/** ADR-0003: a 'N' quality flag zeroes that interval; every other flag (including substituted F/S) counts as-is. */
export function resolveIntervalKwh(quality: string, value: number): number {
  return quality === 'N' ? 0 : value;
}

/**
 * Supply/CL1/CL2/solar pricing shared by every Plan type (they live on the common PlanBase
 * fields and don't depend on how General usage is priced). ADR-0002: a CLn charge (supply or
 * usage) counts only if a register is mapped to CLn.
 */
export function priceSupplyClSolar(
  plan: Plan,
  agg: CategoryUsage,
  days: number,
): {
  supplyCents: number;
  cl1Applicable: boolean;
  cl1Cents: number;
  cl2Applicable: boolean;
  cl2Cents: number;
  solarCreditCents: number;
} {
  const cl1Applicable = agg.mappedCategories.CL1;
  const cl2Applicable = agg.mappedCategories.CL2;

  const supplyCents =
    plan.supply.generalCentsPerDay * days +
    (cl1Applicable ? plan.supply.cl1CentsPerDay * days : 0) +
    (cl2Applicable ? plan.supply.cl2CentsPerDay * days : 0);

  const cl1Cents = cl1Applicable
    ? agg.kwhByCategory.CL1 * plan.controlledLoad.cl1RateCentsPerKwh
    : 0;
  const cl2Cents = cl2Applicable
    ? agg.kwhByCategory.CL2 * plan.controlledLoad.cl2RateCentsPerKwh
    : 0;
  const solarCreditCents = agg.kwhByCategory.Generation * plan.feedInRateCentsPerKwh;

  return { supplyCents, cl1Applicable, cl1Cents, cl2Applicable, cl2Cents, solarCreditCents };
}
