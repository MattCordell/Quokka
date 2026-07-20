import { describe, expect, it } from 'vitest';
import { computeTouBill, priceTouBill, aggregateGeneralWeek } from './tou';
import { aggregateUsage } from './aggregate';
import { daysInPeriod } from './period';
import { CalcError } from './types';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { TouBand, TouPlan } from '../plan/types';

// Half-hourly intervals (48/day, the coarsest TOU pricing accepts) so band boundaries like
// 16:00/21:00 land exactly on a slot; 0.5 kWh/slot keeps every "1 kWh/hour" expectation below
// unchanged from a coarser hourly test, since the same clock-time window sums to the same kWh
// regardless of how finely it's sliced.
function day(overrides: Partial<RegisterDay> = {}): RegisterDay {
  const values = overrides.values ?? new Array(48).fill(0.5);
  return {
    date: '20250701', // Tuesday
    values,
    quality: new Array(values.length).fill('A'),
    ...overrides,
  };
}

function register(overrides: Partial<Register> = {}): Register {
  return {
    nmi: '6407000000',
    registerId: 'E1',
    nmiSuffix: 'E1',
    meterSerial: 'METER01',
    uom: 'kWh',
    intervalLength: 30,
    intervalsPerDay: 48,
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
    lastDate: '20250701',
    dayCount: 1,
  };
}

function touPlan(bands: TouBand[], overrides: Partial<TouPlan> = {}): TouPlan {
  return {
    id: 'plan-test',
    name: 'Test TOU Plan',
    retailer: 'Test Co',
    type: 'time_of_use',
    supply: { generalCentsPerDay: 100, cl1CentsPerDay: 5, cl2CentsPerDay: 3 },
    touBands: bands,
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 15 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
    ...overrides,
  };
}

const PEAK: TouBand = {
  label: 'Peak',
  startTime: '16:00',
  endTime: '21:00',
  rateCentsPerKwh: 50,
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
};
const OFFPEAK_WEEKDAY: TouBand = {
  label: 'Off-peak (weekday)',
  startTime: '21:00',
  endTime: '16:00', // wraps midnight
  rateCentsPerKwh: 25,
  days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
};
const OFFPEAK_WEEKEND: TouBand = {
  label: 'Off-peak (weekend)',
  startTime: '00:00',
  endTime: '24:00',
  rateCentsPerKwh: 25,
  days: ['SAT', 'SUN'],
};

const period = { start: '2025-07-01', end: '2025-07-01' };

describe('priceTouBill / computeTouBill', () => {
  it('splits a flat 1 kWh/hour weekday profile across a midnight-wrapping band correctly', () => {
    const usage = nmiData([register()]); // Tuesday, 24 kWh/day (48 x 0.5 kWh)
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY]);

    const bill = computeTouBill(plan, usage, mapping, period);

    const peak = bill.bands?.find((b) => b.label === 'Peak');
    const offpeak = bill.bands?.find((b) => b.label === 'Off-peak (weekday)');
    expect(peak?.kwh).toBe(5); // 16:00-21:00
    expect(peak?.cents).toBe(250);
    expect(offpeak?.kwh).toBe(19); // the remaining 19 hours, wrapping midnight
    expect(offpeak?.cents).toBe(475);
    expect(bill.generalUsageCents).toBe(725);
  });

  it('assigns weekend usage to the weekend band, not the weekday peak (day-list matching)', () => {
    const usage = nmiData([register({ days: [day({ date: '20250705' })] })]); // Saturday
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY, OFFPEAK_WEEKEND]);

    const bill = computeTouBill(plan, usage, mapping, {
      start: '2025-07-05',
      end: '2025-07-05',
    });

    const peak = bill.bands?.find((b) => b.label === 'Peak');
    const offpeakWeekday = bill.bands?.find((b) => b.label === 'Off-peak (weekday)');
    const offpeakWeekend = bill.bands?.find((b) => b.label === 'Off-peak (weekend)');
    expect(peak?.kwh).toBe(0);
    expect(offpeakWeekday?.kwh).toBe(0);
    expect(offpeakWeekend?.kwh).toBe(24);
  });

  it('sums multiple General registers into the same band (ADR-0011)', () => {
    const usage = nmiData([
      register({ registerId: 'E1' }),
      register({ registerId: 'E2', nmiSuffix: 'E2' }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', E2: 'General' },
    };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY]);

    const bill = computeTouBill(plan, usage, mapping, period);

    const peak = bill.bands?.find((b) => b.label === 'Peak');
    expect(peak?.kwh).toBe(10); // 5 kWh x 2 registers
  });

  it('priceTouBill matches computeTouBill given the same pre-aggregated inputs', () => {
    const usage = nmiData([register()]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY]);

    const viaCompute = computeTouBill(plan, usage, mapping, period);
    const agg = aggregateUsage(usage, mapping, period);
    const generalWeek = aggregateGeneralWeek(usage, mapping, period);
    const days = daysInPeriod(period);
    const viaPrice = priceTouBill(plan, agg, generalWeek, days, period);

    expect(viaPrice).toEqual(viaCompute);
  });

  it('keeps band cents at full precision and rounds only the total (ADR-0004)', () => {
    const usage = nmiData([register({ days: [day({ values: new Array(48).fill(0.05) })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY], {
      supply: { generalCentsPerDay: 0, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      controlledLoad: { cl1RateCentsPerKwh: 0, cl2RateCentsPerKwh: 0 },
      feedInRateCentsPerKwh: 0,
    });

    const bill = computeTouBill(plan, usage, mapping, period);

    const peak = bill.bands?.find((b) => b.label === 'Peak');
    expect(peak?.cents).toBeCloseTo(0.5 * 50, 10); // 0.05 kWh x 10 slots = 0.5 kWh, unrounded x 50c = 25
    expect(Number.isInteger(bill.totalCents)).toBe(true);
  });

  it('allows a negative (net-credit) total, never clamped (ADR-0004)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: new Array(48).fill(0) })] }),
      register({
        registerId: 'B1',
        nmiSuffix: 'B1',
        days: [day({ values: new Array(48).fill(2.5) })],
      }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation' },
    };
    const plan = touPlan([PEAK, OFFPEAK_WEEKDAY], {
      supply: { generalCentsPerDay: 10, cl1CentsPerDay: 0, cl2CentsPerDay: 0 },
      feedInRateCentsPerKwh: 100,
    });

    const bill = computeTouBill(plan, usage, mapping, period);

    expect(bill.totalCents).toBeLessThan(0);
  });

  it('throws CalcError for a General register coarser than the 30-min coverage grid', () => {
    const usage = nmiData([
      register({
        intervalLength: 60,
        intervalsPerDay: 24,
        days: [day({ values: new Array(24).fill(1) })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(() => aggregateGeneralWeek(usage, mapping, period)).toThrow(CalcError);
  });

  it('throws CalcError for an interval length that is <= 30 min but does not divide it evenly', () => {
    // 20 min is finer than the 30-min grid but doesn't divide it, so a slot boundary at an odd
    // half-hour (e.g. 06:30) falls inside a 20-min interval rather than on its edge.
    const usage = nmiData([
      register({
        intervalLength: 20,
        intervalsPerDay: 72,
        days: [day({ values: new Array(72).fill(1) })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(() => aggregateGeneralWeek(usage, mapping, period)).toThrow(CalcError);
  });

  it('throws CalcError when a slot has no covering band, rather than understating the bill', () => {
    const usage = nmiData([register()]); // Tuesday, half-hourly
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const plan = touPlan([PEAK]); // covers only 16:00-21:00 on TUE; the rest of the day is a gap

    expect(() => computeTouBill(plan, usage, mapping, period)).toThrow(CalcError);
  });
});
