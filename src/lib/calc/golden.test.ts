import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNem12 } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan, TouPlan } from '../plan/types';
import { validateBandCoverage } from '../plan/coverage';
import { computeFlatBill } from './flat';
import { computeTouBill } from './tou';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

// ADR-0015: the golden calibration test is the acceptance gate for the calc engine — every
// component below must reproduce fixtures/expected/golden-bills.json exactly.
describe('golden calibration (ADR-0015)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const plan = JSON.parse(readFixture('plans/flat-plan.json')) as FlatPlan;
  const expected = JSON.parse(readFixture('expected/golden-bills.json')).expectedBills[
    'plan-flat-demo'
  ];

  const bill = computeFlatBill(plan, usage, mapping, { start: '2025-07-01', end: '2025-07-02' });

  it('reproduces plan-flat-demo exactly', () => {
    expect(bill.daysInPeriod).toBe(2);
    expect(bill.supplyCents).toBe(expected.supplyCents);
    expect(bill.generalUsageCents).toBe(expected.generalUsageCents);
    expect(bill.cl1Cents).toBe(expected.cl1Cents);
    expect(bill.cl2Cents).toBe(expected.cl2Cents);
    expect(bill.solarCreditCents).toBe(expected.solarCreditCents);
    expect(bill.totalCents).toBe(expected.totalCents);
  });

  it('marks unmapped CL2 not-applicable, distinct from a genuine $0 (ADR-0002)', () => {
    expect(bill.cl1Applicable).toBe(true);
    expect(bill.cl2Applicable).toBe(false);
  });

  it('has no non-actual reads (the golden file is all-A quality)', () => {
    expect(bill.hasNonActualReads).toBe(false);
  });
});

describe('golden calibration TOU (ADR-0015)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
  const expected = JSON.parse(readFixture('expected/golden-bills.json')).expectedBills[
    'plan-tou-demo'
  ];

  const bill = computeTouBill(plan, usage, mapping, { start: '2025-07-01', end: '2025-07-02' });

  it('the golden TOU plan has valid Band Coverage', () => {
    expect(validateBandCoverage(plan.touBands)).toBe(true);
  });

  it('reproduces plan-tou-demo exactly, including the per-band split', () => {
    expect(bill.supplyCents).toBe(expected.supplyCents);
    expect(bill.bands).toBeDefined();
    const peak = bill.bands?.find((b) => b.label === 'Peak');
    const offpeakWeekday = bill.bands?.find((b) => b.label === 'Off-peak (weekday)');
    const offpeakWeekend = bill.bands?.find((b) => b.label === 'Off-peak (weekend)');
    expect(peak?.cents).toBe(1000); // 20 kWh x 50c
    expect(offpeakWeekday?.cents).toBe(950); // 38 kWh x 25c
    expect(offpeakWeekend?.kwh).toBe(0); // golden period is two weekdays only
    expect(bill.generalUsageCents).toBe(expected.generalUsageCents);
    expect(bill.cl1Cents).toBe(expected.cl1Cents);
    expect(bill.cl2Cents).toBe(expected.cl2Cents);
    expect(bill.solarCreditCents).toBe(expected.solarCreditCents);
    expect(bill.totalCents).toBe(expected.totalCents);
  });
});
