import { describe, expect, it } from 'vitest';
import { computeFlatBill, priceFlatBill } from './flat';
import { aggregateUsage } from './aggregate';
import { daysInPeriod } from './period';
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

    expect(bill.bestCaseTotalCents).toBeLessThan(0);
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
    expect(bill.bestCaseTotalCents).toBe(2); // Math.round(2.1)
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
    expect(bill.bestCaseTotalCents).toBe(300);
  });
});

describe('computeFlatBill discounts', () => {
  it('back-compat: with no discounts, both totals equal Math.round(preDiscountCents)', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [5, 5] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = flatPlan();

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.guaranteedTotalCents).toBe(Math.round(bill.preDiscountCents));
    expect(bill.bestCaseTotalCents).toBe(Math.round(bill.preDiscountCents));
  });

  it('excludes the Solar Credit from the discount base', () => {
    // supply 200 + general 800, solar 400, 50% guaranteed on usage+supply => (200+800)*0.5 = 500
    // total = 200 + 800 - 400 - 500 = 100 (a buggy discount-the-post-solar-subtotal would give 300)
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [40, 40] })] }),
      register({ registerId: 'B1', nmiSuffix: 'B1', days: [day({ values: [20, 20] })] }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation' },
    };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 100, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      usage: { generalRateCentsPerKwh: 10 },
      feedInRateCentsPerKwh: 10,
      discounts: [
        {
          id: 'd1',
          label: 'Half off',
          kind: 'guaranteed',
          percent: 50,
          components: ['usage', 'supply'],
        },
      ],
    });

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.supplyCents).toBe(200);
    expect(bill.generalUsageCents).toBe(800);
    expect(bill.solarCreditCents).toBe(400);
    expect(bill.guaranteedTotalCents).toBe(100);
  });

  it('includes CL usage inside the "usage" discount component', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [10, 10] })] }),
      register({ registerId: 'E3', nmiSuffix: 'E3', days: [day({ values: [5, 5] })] }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', E3: 'CL1' },
    };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      usage: { generalRateCentsPerKwh: 10 },
      controlledLoad: { cl1RateCentsPerKwh: 10, cl2RateCentsPerKwh: 0 },
      feedInRateCentsPerKwh: 0,
      discounts: [
        { id: 'd1', label: 'Usage only', kind: 'guaranteed', percent: 10, components: ['usage'] },
      ],
    });

    const bill = computeFlatBill(plan, usage, mapping, period);

    // general 200 + cl1 100 = 300 usage base; 10% = 30
    expect(bill.discountLines[0].baseCents).toBe(300);
    expect(bill.guaranteedDiscountCents).toBe(30);
  });

  it('allows a negative total even with discounts applied, unclamped', () => {
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
      discounts: [
        { id: 'd1', label: '', kind: 'guaranteed', percent: 10, components: ['supply'] },
      ],
    });

    const bill = computeFlatBill(plan, usage, mapping, period);

    expect(bill.bestCaseTotalCents).toBeLessThan(0);
  });

  it('double-rounding guard: a 0.5% guaranteed and 0.5% conditional discount round independently', () => {
    // preDiscountCents = 100.0 exactly (via a non-integer rate producing a clean base)
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [100, 0] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = flatPlan({
      supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      usage: { generalRateCentsPerKwh: 1 },
      feedInRateCentsPerKwh: 0,
      discounts: [
        {
          id: 'g',
          label: '',
          kind: 'guaranteed',
          percent: 0.5,
          components: ['usage'],
        },
        {
          id: 'c',
          label: '',
          kind: 'conditional',
          percent: 0.5,
          components: ['usage'],
        },
      ],
    });

    const bill = computeFlatBill(plan, usage, mapping, { start: '2025-07-01', end: '2025-07-01' });

    // preDiscount = 100; guaranteed 0.5% = 0.5 -> round(99.5) = 100 (banker's-round-half-to-even
    // in JS rounds .5 up, so Math.round(99.5) === 100); best-case 100 - 0.5 - 0.5 = 99 exactly.
    expect(bill.guaranteedTotalCents).toBe(100);
    expect(bill.bestCaseTotalCents).toBe(99);
  });

  it('monotonicity: a larger discount percent never increases the total', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [10, 10] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const smaller = flatPlan({
      discounts: [
        { id: 'd', label: '', kind: 'guaranteed', percent: 5, components: ['usage'] },
      ],
    });
    const larger = flatPlan({
      discounts: [
        { id: 'd', label: '', kind: 'guaranteed', percent: 20, components: ['usage'] },
      ],
    });

    const smallerBill = computeFlatBill(smaller, usage, mapping, period);
    const largerBill = computeFlatBill(larger, usage, mapping, period);

    expect(largerBill.guaranteedTotalCents).toBeLessThanOrEqual(smallerBill.guaranteedTotalCents);
  });
});

describe('priceFlatBill', () => {
  it('matches computeFlatBill given the same pre-aggregated usage (no drift between the two paths)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [1, 1] })] }),
      register({ registerId: 'B1', nmiSuffix: 'B1', days: [day({ values: [0.5, 0.5] })] }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation' },
    };
    const plan = flatPlan();

    const viaCompute = computeFlatBill(plan, usage, mapping, period);
    const agg = aggregateUsage(usage, mapping, period);
    const days = daysInPeriod(period);
    const viaPrice = priceFlatBill(plan, agg, days, period);

    expect(viaPrice).toEqual(viaCompute);
  });

  it('prices multiple plans from a single aggregation pass', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ values: [1, 1] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const agg = aggregateUsage(usage, mapping, period);
    const days = daysInPeriod(period);

    const cheap = flatPlan({ id: 'cheap', usage: { generalRateCentsPerKwh: 10 } });
    const pricey = flatPlan({ id: 'pricey', usage: { generalRateCentsPerKwh: 50 } });

    const bills = [cheap, pricey].map((plan) => priceFlatBill(plan, agg, days, period));

    expect(bills[0].generalUsageCents).toBe(20); // 2 kWh * 10c
    expect(bills[1].generalUsageCents).toBe(100); // 2 kWh * 50c
  });
});
