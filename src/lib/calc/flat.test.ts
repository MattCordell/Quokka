import { describe, expect, it } from 'vitest';
import { computeFlatBill } from './flat';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan } from '../plan/types';

function day(overrides: Partial<RegisterDay>): RegisterDay {
  const values = overrides.values ?? [1, 1];
  return {
    date: '20250701',
    values,
    quality: new Array(values.length).fill('A'),
    ...overrides,
  };
}

function register(overrides: Partial<Register>): Register {
  return {
    nmi: '6407000000',
    registerId: 'E1',
    nmiSuffix: 'E1',
    meterSerial: 'METER01',
    uom: 'kWh',
    intervalLength: 720,
    intervalsPerDay: 2,
    days: [day({})],
    totalKwh: 0,
    ...overrides,
  };
}

function nmiData(registers: Register[]): NmiData {
  return {
    nmi: '6407000000',
    registers,
    firstDate: '20250701',
    lastDate: '20250702',
    dayCount: 2,
  };
}

function flatPlan(overrides: Partial<FlatPlan> = {}): FlatPlan {
  return {
    id: 'plan-test',
    name: 'Test Plan',
    retailer: 'Test Co',
    type: 'flat_rate',
    supply: { generalCentsPerDay: 100, cl1CentsPerDay: 5, cl2CentsPerDay: 3 },
    usage: { generalRateCentsPerKwh: 30 },
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 15 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
    ...overrides,
  };
}

const period = { start: '2025-07-01', end: '2025-07-02' };

describe('computeFlatBill', () => {
  it('excludes an unmapped CL from supply and usage, distinct from a genuine $0 (ADR-0002)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [1, 1] })] }),
      register({ registerId: 'E3', nmiSuffix: 'E3', days: [day({ values: [1, 1] })] }),
    ]);
    // CL2 is not in the mapping at all, even though the plan's cl2CentsPerDay (3) is nonzero.
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', E3: 'CL1' },
    };
    const plan = flatPlan();

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.cl2Applicable).toBe(false);
    expect(bill.cl2Cents).toBe(0);
    // supply = general(100*2) + cl1(5*2, mapped) ; cl2's 3c/day never counted despite being set.
    expect(bill.supplyCents).toBe(100 * 2 + 5 * 2);
  });

  it('allows a negative (net-credit) total, never clamped to $0 (ADR-0004)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [0, 0] })] }),
      register({ registerId: 'B1', nmiSuffix: 'B1', days: [day({ values: [50, 50] })] }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation' },
    };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 10, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      feedInRateCentsPerKwh: 100,
    });

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.totalCents).toBeLessThan(0);
  });

  it('keeps components at full precision and rounds only the total (ADR-0004)', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [0.5, 0.2] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      usage: { generalRateCentsPerKwh: 3 },
      feedInRateCentsPerKwh: 0,
    });

    const bill = computeFlatBill(plan, usage, mapping, { start: '2025-07-01', end: '2025-07-01' });

    expect(bill.generalUsageCents).toBeCloseTo(2.1); // 0.7 kWh * 3c, unrounded
    expect(bill.totalCents).toBe(2); // Math.round(2.1)
  });

  it('applies rates verbatim with no GST markup', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [5, 5] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      usage: { generalRateCentsPerKwh: 30 },
      feedInRateCentsPerKwh: 0,
    });

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.generalUsageCents).toBe(300); // 10 kWh * 30c, no added tax
    expect(bill.totalCents).toBe(300);
  });
});
