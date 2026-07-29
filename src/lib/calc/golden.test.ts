import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNem12 } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import { isValidPlan, type FlatPlan, type TouPlan } from '../plan/types';
import { validateBandCoverage } from '../plan/coverage';
import { applyPlanImport, parsePlanImport } from '../plan/transfer';
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
    expect(bill.guaranteedTotalCents).toBe(expected.guaranteedTotalCents);
    expect(bill.bestCaseTotalCents).toBe(expected.bestCaseTotalCents);
  });

  it('isValidPlan accepts the fixture plan verbatim', () => {
    expect(isValidPlan(plan)).toBe(true);
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
    expect(bill.guaranteedTotalCents).toBe(expected.guaranteedTotalCents);
    expect(bill.bestCaseTotalCents).toBe(expected.bestCaseTotalCents);
  });

  it('isValidPlan accepts the fixture plan verbatim', () => {
    expect(isValidPlan(plan)).toBe(true);
  });
});

describe('golden calibration discounted flat plan (ADR-0007)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const plan = JSON.parse(readFixture('plans/flat-plan-discounted.json')) as FlatPlan;
  const expected = JSON.parse(readFixture('expected/golden-bills.json')).expectedBills[
    'plan-flat-discount-demo'
  ];

  const bill = computeFlatBill(plan, usage, mapping, { start: '2025-07-01', end: '2025-07-02' });

  it('isValidPlan accepts the fixture plan verbatim', () => {
    expect(isValidPlan(plan)).toBe(true);
  });

  it('reproduces the discounted bill exactly: $17.87 guaranteed, $16.96 best-case', () => {
    expect(bill.preDiscountCents).toBe(expected.preDiscountCents);
    expect(bill.guaranteedDiscountCents).toBe(expected.guaranteedDiscountCents);
    expect(bill.conditionalDiscountCents).toBe(expected.conditionalDiscountCents);
    expect(bill.guaranteedTotalCents).toBe(expected.guaranteedTotalCents);
    expect(bill.bestCaseTotalCents).toBe(expected.bestCaseTotalCents);
  });
});

describe('golden calibration ranking (ADR-0007)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const period = { start: '2025-07-01', end: '2025-07-02' };

  it('the discounted flat plan is cheapest, then plain flat, then TOU, on bestCaseTotalCents', () => {
    const flatPlan = JSON.parse(readFixture('plans/flat-plan.json')) as FlatPlan;
    const discountPlan = JSON.parse(readFixture('plans/flat-plan-discounted.json')) as FlatPlan;
    const touPlan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;

    const flatBill = computeFlatBill(flatPlan, usage, mapping, period);
    const discountBill = computeFlatBill(discountPlan, usage, mapping, period);
    const touBill = computeTouBill(touPlan, usage, mapping, period);

    expect(discountBill.bestCaseTotalCents).toBeLessThan(flatBill.bestCaseTotalCents);
    expect(flatBill.bestCaseTotalCents).toBeLessThan(touBill.bestCaseTotalCents);
  });
});

// issue #10 AC: fixture proof that an imported plan reproduces the golden totals.
describe('golden calibration import round-trip (issue #10)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const period = { start: '2025-07-01', end: '2025-07-02' };

  it('imports flat-plan.json and reproduces the golden $19.90 bill', () => {
    const importResult = parsePlanImport(readFixture('plans/flat-plan.json'), []);
    expect(importResult.candidates[0].importable).toBe(true);

    const [importedPlan] = applyPlanImport([], importResult.candidates, {}, 'merge') as [FlatPlan];
    const bill = computeFlatBill(importedPlan, usage, mapping, period);

    expect(bill.guaranteedTotalCents).toBe(1990);
    expect(bill.bestCaseTotalCents).toBe(1990);
  });

  it('imports tou-plan.json and reproduces the golden $22.20 bill', () => {
    const importResult = parsePlanImport(readFixture('plans/tou-plan.json'), []);
    expect(importResult.candidates[0].importable).toBe(true);

    const [importedPlan] = applyPlanImport([], importResult.candidates, {}, 'merge') as [TouPlan];
    const bill = computeTouBill(importedPlan, usage, mapping, period);

    expect(bill.guaranteedTotalCents).toBe(2220);
    expect(bill.bestCaseTotalCents).toBe(2220);
  });
});
