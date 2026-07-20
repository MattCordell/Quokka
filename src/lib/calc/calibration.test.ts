import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FlatPlan } from '../plan/types';
import { computeCalibration, manualCategoryUsage } from './calibration';
import type { ManualBillInput } from './calibration';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

const plan = JSON.parse(readFixture('plans/flat-plan.json')) as FlatPlan;
const expected = JSON.parse(readFixture('expected/golden-bills.json')).expectedBills[
  'plan-flat-demo'
];

// The golden scenario (fixtures/README.md, PRD §5.2 acceptance criterion), entered by hand rather
// than parsed from NEM12: 2-day period, 58 kWh General, 4 kWh CL1, 8 kWh export, actual $19.90.
const goldenInput: ManualBillInput = {
  period: { start: '2025-07-01', end: '2025-07-02' },
  generalKwh: 58,
  cl1Kwh: 4,
  cl2Kwh: null,
  feedInKwh: 8,
  actualCents: 1990,
};

// Hoisted once and reused across the describes below (mirroring plan/expected/goldenInput
// above) — they all assert against the same golden computation, not independent scenarios.
const goldenResult = computeCalibration(plan, goldenInput);

describe('computeCalibration — golden scenario (ADR-0015 acceptance test)', () => {
  it('shows $0.00 difference and 0% variance against the real invoice total', () => {
    expect(goldenResult.differenceCents).toBe(0);
    expect(goldenResult.variancePct).toBe(0);
    expect(goldenResult.bill.totalCents).toBe(1990);
  });

  it('reproduces the golden bill component-for-component — same engine, not a parallel path', () => {
    expect(goldenResult.bill.daysInPeriod).toBe(2);
    expect(goldenResult.bill.supplyCents).toBe(expected.supplyCents);
    expect(goldenResult.bill.generalUsageCents).toBe(expected.generalUsageCents);
    expect(goldenResult.bill.cl1Cents).toBe(expected.cl1Cents);
    expect(goldenResult.bill.cl2Cents).toBe(expected.cl2Cents);
    expect(goldenResult.bill.solarCreditCents).toBe(expected.solarCreditCents);
  });
});

describe('manualCategoryUsage — ADR-0002 bypass via direct CL entry', () => {
  it('marks CL1 applicable when a figure is entered, bypassing the register-mapping gate', () => {
    const agg = manualCategoryUsage(goldenInput);
    expect(agg.mappedCategories.CL1).toBe(true);
    expect(agg.kwhByCategory.CL1).toBe(4);
  });

  it('marks CL2 not-applicable when left blank (null), distinct from a genuine 0 kWh', () => {
    const agg = manualCategoryUsage(goldenInput);
    expect(agg.mappedCategories.CL2).toBe(false);
    expect(agg.kwhByCategory.CL2).toBe(0);
  });

  it('marks CL2 applicable when the user explicitly enters 0 kWh (not the same as blank)', () => {
    const agg = manualCategoryUsage({ ...goldenInput, cl2Kwh: 0 });
    expect(agg.mappedCategories.CL2).toBe(true);
    expect(agg.kwhByCategory.CL2).toBe(0);
  });

  it('never gates solar/Generation on a mapped flag', () => {
    const agg = manualCategoryUsage(goldenInput);
    expect(agg.kwhByCategory.Generation).toBe(8);
  });
});

describe('computeCalibration — ADR-0002 gating reflected in the priced bill', () => {
  it('cl1Applicable is true, cl2Applicable is false, matching manual entry (no CL2 entered)', () => {
    expect(goldenResult.bill.cl1Applicable).toBe(true);
    expect(goldenResult.bill.cl2Applicable).toBe(false);
    expect(goldenResult.bill.cl2Cents).toBe(0);
  });
});

describe('computeCalibration — ADR-0005 inclusive day count', () => {
  it('counts both endpoints of the entered period', () => {
    expect(goldenResult.bill.daysInPeriod).toBe(2);
  });
});

describe('computeCalibration — non-zero variance (drives the ADR-0004 rounding-tension note)', () => {
  it('reports a signed cent difference and matching percentage variance', () => {
    const result = computeCalibration(plan, { ...goldenInput, actualCents: 1980 });
    expect(result.differenceCents).toBe(10);
    expect(result.variancePct).toBeCloseTo((10 / 1980) * 100, 5);
  });

  it('allows a negative difference when the actual bill was higher than calculated', () => {
    const result = computeCalibration(plan, { ...goldenInput, actualCents: 2000 });
    expect(result.differenceCents).toBe(-10);
    expect(result.variancePct).toBeCloseTo((-10 / 2000) * 100, 5);
  });

  it('reports null variance when the entered actual total is $0 (division undefined)', () => {
    const result = computeCalibration(plan, { ...goldenInput, actualCents: 0 });
    expect(result.variancePct).toBeNull();
  });
});
