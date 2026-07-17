import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNem12 } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan } from '../plan/types';
import { computeFlatBill } from './flat';

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
