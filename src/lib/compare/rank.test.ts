import { describe, expect, it } from 'vitest';
import { rankPlanBills } from './rank';
import type { PlanBill } from './rank';
import type { Bill } from '../calc/types';
import type { FlatPlan } from '../plan/types';

function plan(id: string, name: string): FlatPlan {
  return {
    id,
    name,
    retailer: 'Test Co',
    type: 'flat_rate',
    supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
    usage: { generalRateCentsPerKwh: 0 },
    controlledLoad: { cl1RateCentsPerKwh: 0, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 0,
    discounts: [],
  };
}

function bill(guaranteedTotalCents: number, bestCaseTotalCents: number = guaranteedTotalCents): Bill {
  return {
    planId: 'x',
    period: { start: '2025-07-01', end: '2025-07-01' },
    daysInPeriod: 1,
    supplyCents: 0,
    generalUsageCents: 0,
    cl1Applicable: false,
    cl1Cents: 0,
    cl2Applicable: false,
    cl2Cents: 0,
    solarCreditCents: 0,
    preDiscountCents: guaranteedTotalCents,
    guaranteedDiscountCents: 0,
    conditionalDiscountCents: 0,
    guaranteedTotalCents,
    bestCaseTotalCents,
    discountLines: [],
    hasNonActualReads: false,
    nonActualDayCount: 0,
  };
}

function row(id: string, name: string, guaranteed: number, bestCase = guaranteed): PlanBill {
  return { plan: plan(id, name), bill: bill(guaranteed, bestCase) };
}

describe('rankPlanBills', () => {
  it('ranks cheapest first, dense', () => {
    const rows = [row('a', 'Alpha', 300), row('b', 'Beta', 100), row('c', 'Gamma', 200)];
    const ranked = rankPlanBills(rows, 'bestCase');

    expect(ranked.map((r) => r.plan.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('gives exact ties the same dense rank and both isCheapest', () => {
    const rows = [row('a', 'Alpha', 100), row('b', 'Beta', 100), row('c', 'Gamma', 300)];
    const ranked = rankPlanBills(rows, 'bestCase');

    const [first, second, third] = ranked;
    expect(first.rank).toBe(1);
    expect(second.rank).toBe(1);
    expect(third.rank).toBe(2);
    expect(first.isCheapest).toBe(true);
    expect(second.isCheapest).toBe(true);
    expect(third.isCheapest).toBe(false);
  });

  it('computes deltaCents relative to the cheapest', () => {
    const rows = [row('a', 'Alpha', 300), row('b', 'Beta', 100)];
    const ranked = rankPlanBills(rows, 'bestCase');

    const cheapest = ranked.find((r) => r.plan.id === 'b')!;
    const runnerUp = ranked.find((r) => r.plan.id === 'a')!;
    expect(cheapest.deltaCents).toBe(0);
    expect(runnerUp.deltaCents).toBe(200);
  });

  it('reorders when the basis switches between guaranteed and bestCase', () => {
    // a: guaranteed 300, bestCase 100 (a big conditional discount)
    // b: guaranteed 200, bestCase 200 (no discount)
    const rows = [row('a', 'Alpha', 300, 100), row('b', 'Beta', 200, 200)];

    const byGuaranteed = rankPlanBills(rows, 'guaranteed');
    expect(byGuaranteed.map((r) => r.plan.id)).toEqual(['b', 'a']);

    const byBestCase = rankPlanBills(rows, 'bestCase');
    expect(byBestCase.map((r) => r.plan.id)).toEqual(['a', 'b']);
  });

  it('falls back to name.localeCompare for stable ordering among ties', () => {
    const rows = [row('a', 'Zebra', 100), row('b', 'Apple', 100)];
    const ranked = rankPlanBills(rows, 'bestCase');

    expect(ranked.map((r) => r.plan.name)).toEqual(['Apple', 'Zebra']);
  });

  it('returns an empty array for empty input', () => {
    expect(rankPlanBills([], 'bestCase')).toEqual([]);
  });
});
