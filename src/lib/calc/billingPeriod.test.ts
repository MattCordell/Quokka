import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_DAYS,
  resolveLastQuarter,
  resolveAnnual,
  scaleCategoryUsage,
  scaleGeneralWeek,
} from './billingPeriod';
import { aggregateUsage } from './aggregate';
import { aggregateGeneralWeek, priceTouBill } from './tou';
import { priceFlatBill } from './flat';
import { daysInPeriod, isoToCompact } from './period';
import { parseNem12 } from '../nem12';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { CategoryUsage } from './types';
import type { FlatPlan, TouPlan } from '../plan/types';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

/** ISO date arithmetic via Date.UTC, matching period.ts's timezone-immune style. */
function isoPlusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** A synthetic General register with one 1 kWh reading per day, `numDays` days starting `startIso`. */
function dailyGeneralRegister(startIso: string, numDays: number): Register {
  const days: RegisterDay[] = [];
  for (let i = 0; i < numDays; i++) {
    days.push({ date: isoToCompact(isoPlusDays(startIso, i)), values: [1], quality: ['A'] });
  }
  return {
    nmi: '6407000000',
    registerId: 'E1',
    nmiSuffix: 'E1',
    meterSerial: 'METER01',
    uom: 'kWh',
    intervalLength: 1440,
    intervalsPerDay: 1,
    days,
    totalKwh: numDays,
  };
}

function nmiData(registers: Register[]): NmiData {
  return {
    nmi: '6407000000',
    registers,
    firstDate: registers[0].days[0].date,
    lastDate: registers[0].days[registers[0].days.length - 1].date,
    dayCount: registers[0].days.length,
  };
}

describe('resolveLastQuarter (ADR-0009)', () => {
  it('drops a partial trailing month (the ADR-0009 example: ending 2025-07-14 -> Q2)', () => {
    const span = { start: '2025-01-01', end: '2025-07-14' };
    expect(resolveLastQuarter(span)).toEqual({ start: '2025-04-01', end: '2025-06-30' });
  });

  it('includes the end month itself when it is a complete calendar month', () => {
    const span = { start: '2025-01-01', end: '2025-07-31' };
    expect(resolveLastQuarter(span)).toEqual({ start: '2025-05-01', end: '2025-07-31' });
  });

  it('returns non-null when exactly 3 full months of data exist', () => {
    const span = { start: '2025-04-01', end: '2025-06-30' };
    expect(resolveLastQuarter(span)).toEqual({ start: '2025-04-01', end: '2025-06-30' });
  });

  it('returns null when the quarter start is missing from the data by a single day', () => {
    const span = { start: '2025-04-02', end: '2025-06-30' };
    expect(resolveLastQuarter(span)).toBeNull();
  });

  it('returns null for the 2-day golden span', () => {
    const span = { start: '2025-07-01', end: '2025-07-02' };
    expect(resolveLastQuarter(span)).toBeNull();
  });

  it('resolves a quarter spanning a year boundary (ending 2026-01-15 -> Q4 2025)', () => {
    const span = { start: '2025-01-01', end: '2026-01-15' };
    expect(resolveLastQuarter(span)).toEqual({ start: '2025-10-01', end: '2025-12-31' });
  });

  it('resolves a leap-year February month end correctly', () => {
    const span = { start: '2023-01-01', end: '2024-02-29' };
    expect(resolveLastQuarter(span)).toEqual({ start: '2023-12-01', end: '2024-02-29' });
  });
});

describe('resolveAnnual (ADR-0006)', () => {
  it('ANNUAL_DAYS is a flat 365', () => {
    expect(ANNUAL_DAYS).toBe(365);
  });

  it('sums actuals over exactly 365 days with no scaling', () => {
    const span = { start: '2025-01-01', end: '2025-12-31' }; // 2025 is not a leap year
    expect(daysInPeriod(span)).toBe(365);

    const window = resolveAnnual(span);

    expect(window.factor).toBe(1);
    expect(window.extrapolated).toBe(false);
    expect(window.sampledDays).toBe(365);
    expect(window.days).toBe(365);
    expect(window.period).toEqual(span);
  });

  it('sums only the most recent 365 days of a 398-day span, never the whole span', () => {
    const start = '2024-01-01';
    const end = isoPlusDays(start, 397); // 398 days inclusive
    const span = { start, end };
    expect(daysInPeriod(span)).toBe(398);

    const window = resolveAnnual(span);

    expect(window.sampledDays).toBe(365);
    expect(window.factor).toBe(1);
    expect(window.extrapolated).toBe(false);
    expect(window.days).toBe(365);
    expect(window.period.end).toBe(end);
    expect(window.period.start).toBe(isoPlusDays(end, -364));

    const usage = nmiData([dailyGeneralRegister(start, 398)]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    const wholeSpanKwh = aggregateUsage(usage, mapping, span).kwhByCategory.General;
    const windowKwh = aggregateUsage(usage, mapping, window.period).kwhByCategory.General;

    expect(wholeSpanKwh).toBe(398);
    expect(windowKwh).toBe(365);
    expect(windowKwh).toBeLessThan(wholeSpanKwh);
  });

  it('extrapolates a 2-day span by a factor of 182.5 (365/2)', () => {
    const span = { start: '2025-07-01', end: '2025-07-02' };

    const window = resolveAnnual(span);

    expect(window.factor).toBe(182.5);
    expect(window.extrapolated).toBe(true);
    expect(window.sampledDays).toBe(2);
    expect(window.days).toBe(365);
    expect(window.period).toEqual(span);
  });
});

describe('scaleCategoryUsage', () => {
  it('scales every category by factor, preserving flags, mappings, and gap-disclosure fields', () => {
    const agg: CategoryUsage = {
      kwhByCategory: { General: 10, CL1: 2, CL2: 0, Generation: 4, Ignore: 0 },
      mappedCategories: { General: true, CL1: true, CL2: false, Generation: true, Ignore: false },
      hasNonActualReads: true,
      nonActualDayCount: 3,
      daysWithData: 5,
    };

    const scaled = scaleCategoryUsage(agg, 2.5);

    expect(scaled.kwhByCategory).toEqual({
      General: 25,
      CL1: 5,
      CL2: 0,
      Generation: 10,
      Ignore: 0,
    });
    expect(scaled.mappedCategories).toEqual(agg.mappedCategories);
    expect(scaled.hasNonActualReads).toBe(true);
    expect(scaled.nonActualDayCount).toBe(3);
    expect(scaled.daysWithData).toBe(5);
  });
});

describe('scaleGeneralWeek', () => {
  it('scales every slot by factor and preserves the map keys', () => {
    const week = new Map([
      ['MON|0', 1],
      ['TUE|30', 2],
    ]);

    const scaled = scaleGeneralWeek(week, 3);

    expect(scaled.get('MON|0')).toBe(3);
    expect(scaled.get('TUE|30')).toBe(6);
    expect([...scaled.keys()].sort()).toEqual([...week.keys()].sort());
  });
});

describe('golden-fixture extrapolation proof (ADR-0006)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const span = { start: '2025-07-01', end: '2025-07-02' };
  const window = resolveAnnual(span);

  it('scales the golden 2-day General total (58 kWh) by 182.5x', () => {
    const agg = aggregateUsage(usage, mapping, window.period);
    expect(agg.kwhByCategory.General).toBe(58);

    const scaled = scaleCategoryUsage(agg, window.factor);
    expect(scaled.kwhByCategory.General).toBe(58 * 182.5);
    expect(window.days).toBe(365);
  });

  it('reproduces the extrapolated flat total: $3631.75 (golden $19.90 x 182.5)', () => {
    const plan = JSON.parse(readFixture('plans/flat-plan.json')) as FlatPlan;
    const agg = scaleCategoryUsage(aggregateUsage(usage, mapping, window.period), window.factor);

    const bill = priceFlatBill(plan, agg, window.days, window.period);

    expect(bill.bestCaseTotalCents).toBe(363175);
  });

  it('reproduces the extrapolated TOU total: 405150c (golden 2220c x 182.5), shape preserved', () => {
    const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
    const agg = scaleCategoryUsage(aggregateUsage(usage, mapping, window.period), window.factor);
    const generalWeek = scaleGeneralWeek(
      aggregateGeneralWeek(usage, mapping, window.period),
      window.factor,
    );

    const bill = priceTouBill(plan, agg, generalWeek, window.days, window.period);

    expect(bill.bestCaseTotalCents).toBe(405150);

    const unscaledAgg = aggregateUsage(usage, mapping, window.period);
    const unscaledWeek = aggregateGeneralWeek(usage, mapping, window.period);
    const unscaledDays = daysInPeriod(window.period);
    const unscaledBill = priceTouBill(plan, unscaledAgg, unscaledWeek, unscaledDays, window.period);

    const scaledTotal = bill.bands!.reduce((sum, b) => sum + b.kwh, 0);
    const unscaledTotal = unscaledBill.bands!.reduce((sum, b) => sum + b.kwh, 0);
    bill.bands!.forEach((band, i) => {
      const scaledShare = band.kwh / scaledTotal;
      const unscaledShare = unscaledBill.bands![i].kwh / unscaledTotal;
      expect(scaledShare).toBeCloseTo(unscaledShare, 10);
    });
  });
});
