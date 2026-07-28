import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_DAYS,
  resolveLastQuarter,
  quarterMonthPeriods,
  resolveAnnualPeriod,
  scaleCategoryUsage,
  scaleGeneralWeek,
  missingDaysOfWeek,
  describeExtrapolation,
} from './billingPeriod';
import { aggregateUsage } from './aggregate';
import { aggregateGeneralWeek, countGeneralDaysByDow, priceTouBill } from './tou';
import { priceFlatBill } from './flat';
import { daysInPeriod, isoToCompact } from './period';
import { parseNem12 } from '../nem12';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { CategoryUsage } from './types';
import type { FlatPlan, TouPlan } from '../plan/types';
import { CalcError } from './types';

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

  it('throws rather than silently resolving a quarter from a reversed span', () => {
    expect(() => resolveLastQuarter({ start: '2025-06-01', end: '2025-01-01' })).toThrow(CalcError);
  });
});

describe('quarterMonthPeriods', () => {
  it('splits a quarter into its 3 constituent calendar months', () => {
    const quarter = { start: '2025-04-01', end: '2025-06-30' };
    expect(quarterMonthPeriods(quarter)).toEqual([
      { start: '2025-04-01', end: '2025-04-30' },
      { start: '2025-05-01', end: '2025-05-31' },
      { start: '2025-06-01', end: '2025-06-30' },
    ]);
  });

  it('splits a year-boundary quarter correctly', () => {
    const quarter = { start: '2025-10-01', end: '2025-12-31' };
    expect(quarterMonthPeriods(quarter)).toEqual([
      { start: '2025-10-01', end: '2025-10-31' },
      { start: '2025-11-01', end: '2025-11-30' },
      { start: '2025-12-01', end: '2025-12-31' },
    ]);
  });
});

describe('resolveAnnualPeriod (ADR-0006)', () => {
  it('ANNUAL_DAYS is a flat 365', () => {
    expect(ANNUAL_DAYS).toBe(365);
  });

  it('returns the whole span unchanged when it is exactly 365 days', () => {
    const span = { start: '2025-01-01', end: '2025-12-31' }; // 2025 is not a leap year
    expect(daysInPeriod(span)).toBe(365);
    expect(resolveAnnualPeriod(span)).toEqual(span);
  });

  it('returns the most recent 365 days of a 398-day span, never the whole span', () => {
    const start = '2024-01-01';
    const end = isoPlusDays(start, 397); // 398 days inclusive
    const span = { start, end };
    expect(daysInPeriod(span)).toBe(398);

    const period = resolveAnnualPeriod(span);

    expect(period.end).toBe(end);
    expect(period.start).toBe(isoPlusDays(end, -364));
    expect(daysInPeriod(period)).toBe(365);

    // Proof it's actually used to truncate the aggregation, not just the label: summing the
    // resolved period must exclude the first 33 days of a 398-day, 1 kWh/day sample.
    const usage = nmiData([dailyGeneralRegister(start, 398)]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const wholeSpanKwh = aggregateUsage(usage, mapping, span).kwhByCategory.General;
    const windowKwh = aggregateUsage(usage, mapping, period).kwhByCategory.General;
    expect(wholeSpanKwh).toBe(398);
    expect(windowKwh).toBe(365);
    expect(windowKwh).toBeLessThan(wholeSpanKwh);
  });

  it('returns the whole span unchanged when it is shorter than 365 days', () => {
    const span = { start: '2025-07-01', end: '2025-07-02' };
    expect(resolveAnnualPeriod(span)).toEqual(span);
  });
});

function categoryUsage(overrides: Partial<CategoryUsage> = {}): CategoryUsage {
  return {
    kwhByCategory: { General: 0, CL1: 0, CL2: 0, Generation: 0, Ignore: 0 },
    mappedCategories: { General: true, CL1: true, CL2: true, Generation: true, Ignore: false },
    hasNonActualReads: false,
    nonActualDayCount: 0,
    daysWithData: { General: 365, CL1: 365, CL2: 365, Generation: 365, Ignore: 0 },
    ...overrides,
  };
}

describe('scaleCategoryUsage (ADR-0006)', () => {
  it('scales each category by its own coverage factor, not one blanket factor', () => {
    // General is gappy (2 of the 365 days), Generation is fully covered — a real scenario is a
    // solar register reading every day while a General meter has a swap-related gap.
    const agg = categoryUsage({
      kwhByCategory: { General: 10, CL1: 0, CL2: 0, Generation: 20, Ignore: 0 },
      daysWithData: { General: 2, CL1: 0, CL2: 0, Generation: 365, Ignore: 0 },
    });

    const scaled = scaleCategoryUsage(agg);

    expect(scaled.kwhByCategory.General).toBe(10 * (365 / 2));
    expect(scaled.kwhByCategory.Generation).toBe(20); // already fully covered — left as-is
  });

  it('does not scale a category whose coverage already meets or exceeds ANNUAL_DAYS', () => {
    const agg = categoryUsage({
      kwhByCategory: { General: 100, CL1: 0, CL2: 0, Generation: 0, Ignore: 0 },
      daysWithData: { General: 365, CL1: 0, CL2: 0, Generation: 0, Ignore: 0 },
    });

    expect(scaleCategoryUsage(agg).kwhByCategory.General).toBe(100);
  });

  it('leaves a zero-coverage category at zero rather than dividing by zero', () => {
    const agg = categoryUsage({
      kwhByCategory: { General: 0, CL1: 0, CL2: 0, Generation: 0, Ignore: 0 },
      daysWithData: { General: 0, CL1: 0, CL2: 0, Generation: 0, Ignore: 0 },
    });

    const scaled = scaleCategoryUsage(agg);

    expect(scaled.kwhByCategory.General).toBe(0);
    expect(Number.isFinite(scaled.kwhByCategory.General)).toBe(true);
  });

  it('preserves mappedCategories, hasNonActualReads, nonActualDayCount and daysWithData unchanged', () => {
    const agg = categoryUsage({
      kwhByCategory: { General: 10, CL1: 2, CL2: 0, Generation: 4, Ignore: 0 },
      mappedCategories: { General: true, CL1: true, CL2: false, Generation: true, Ignore: false },
      hasNonActualReads: true,
      nonActualDayCount: 3,
      daysWithData: { General: 2, CL1: 2, CL2: 0, Generation: 2, Ignore: 0 },
    });

    const scaled = scaleCategoryUsage(agg);

    expect(scaled.mappedCategories).toEqual(agg.mappedCategories);
    expect(scaled.hasNonActualReads).toBe(true);
    expect(scaled.nonActualDayCount).toBe(3);
    expect(scaled.daysWithData).toEqual(agg.daysWithData);
  });
});

describe('scaleGeneralWeek (ADR-0006)', () => {
  it('scales each day of the week by its own coverage factor, not one blanket factor', () => {
    // TUE sampled once, WED sampled twice (e.g. a 3-day span Tue-Wed-Wed is impossible, but a
    // longer sample can easily land 2 Wednesdays and 1 Tuesday) — each must scale independently.
    const week = new Map([
      ['TUE|0', 10],
      ['WED|0', 20],
    ]);
    const daysByDow = {
      MON: 0,
      TUE: 1,
      WED: 2,
      THU: 0,
      FRI: 0,
      SAT: 0,
      SUN: 0,
    } as const;

    const scaled = scaleGeneralWeek(week, daysByDow);

    expect(scaled.get('TUE|0')).toBe(10 * (365 / 7 / 1));
    expect(scaled.get('WED|0')).toBe(20 * (365 / 7 / 2));
    // Proof the two factors actually differ (this is what a blanket factor would get wrong):
    expect(scaled.get('TUE|0')! / 10).not.toBeCloseTo(scaled.get('WED|0')! / 20, 5);
  });

  it('does not scale a day of the week whose coverage already meets or exceeds 365/7', () => {
    const week = new Map([['TUE|0', 100]]);
    const daysByDow = { MON: 0, TUE: 53, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 } as const;

    expect(scaleGeneralWeek(week, daysByDow).get('TUE|0')).toBe(100);
  });

  it('leaves a day of the week absent from the map absent after scaling — no data is fabricated', () => {
    const week = new Map([['TUE|0', 10]]);
    const daysByDow = { MON: 0, TUE: 1, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 } as const;

    const scaled = scaleGeneralWeek(week, daysByDow);

    expect(scaled.has('MON|0')).toBe(false);
    expect([...scaled.keys()]).toEqual(['TUE|0']);
  });
});

describe('missingDaysOfWeek', () => {
  it('lists every day of the week with zero samples', () => {
    const daysByDow = { MON: 0, TUE: 1, WED: 1, THU: 0, FRI: 0, SAT: 0, SUN: 0 } as const;
    expect(missingDaysOfWeek(daysByDow)).toEqual(['MON', 'THU', 'FRI', 'SAT', 'SUN']);
  });

  it('is empty when every day of the week has at least one sample', () => {
    const daysByDow = { MON: 1, TUE: 1, WED: 1, THU: 1, FRI: 1, SAT: 1, SUN: 1 } as const;
    expect(missingDaysOfWeek(daysByDow)).toEqual([]);
  });
});

describe('describeExtrapolation', () => {
  it('is null when General coverage already meets ANNUAL_DAYS', () => {
    const agg = categoryUsage({ daysWithData: { ...categoryUsage().daysWithData, General: 365 } });
    expect(describeExtrapolation(agg)).toBeNull();
  });

  it('describes the factor and sampled days when General coverage is short', () => {
    const agg = categoryUsage({ daysWithData: { ...categoryUsage().daysWithData, General: 2 } });
    expect(describeExtrapolation(agg)).toEqual({ factor: 365 / 2, sampledDays: 2 });
  });
});

describe('golden-fixture extrapolation proof (ADR-0006)', () => {
  const parsed = parseNem12(readFixture('nem12/nem12-golden.csv'));
  const usage = parsed.nmis[0];
  const mapping = JSON.parse(
    readFixture('mapping/golden-register-mapping.json'),
  ) as RegisterMapping;
  const span = { start: '2025-07-01', end: '2025-07-02' }; // Tue + Wed
  const period = resolveAnnualPeriod(span);

  it('resolveAnnualPeriod leaves the 2-day golden span unchanged (shorter than 365 days)', () => {
    expect(period).toEqual(span);
  });

  it('every mapped category shares the same 2-day coverage, so the category factor is uniform', () => {
    const agg = aggregateUsage(usage, mapping, period);
    expect(agg.daysWithData.General).toBe(2);
    expect(agg.daysWithData.CL1).toBe(2);
    expect(agg.daysWithData.Generation).toBe(2);
    expect(describeExtrapolation(agg)).toEqual({ factor: 182.5, sampledDays: 2 });
  });

  it('reproduces the extrapolated flat total: $3631.75 (golden $19.90 x 182.5)', () => {
    const plan = JSON.parse(readFixture('plans/flat-plan.json')) as FlatPlan;
    const agg = scaleCategoryUsage(aggregateUsage(usage, mapping, period));

    const bill = priceFlatBill(plan, agg, ANNUAL_DAYS, period, describeExtrapolation(agg));

    expect(bill.bestCaseTotalCents).toBe(363175);
    expect(bill.extrapolation).toEqual({ factor: 182.5, sampledDays: 2 });
  });

  it('countGeneralDaysByDow finds exactly one Tuesday and one Wednesday, nothing else', () => {
    const daysByDow = countGeneralDaysByDow(usage, mapping, period);
    expect(daysByDow.TUE).toBe(1);
    expect(daysByDow.WED).toBe(1);
    expect(missingDaysOfWeek(daysByDow)).toEqual(['MON', 'THU', 'FRI', 'SAT', 'SUN']);
  });

  it(
    'prices the extrapolated TOU total from the actual per-day-of-week coverage, ' +
      'not the flat plan’s category-level 182.5x factor',
    () => {
      const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
      const agg = scaleCategoryUsage(aggregateUsage(usage, mapping, period));
      const daysByDow = countGeneralDaysByDow(usage, mapping, period);
      const generalWeek = scaleGeneralWeek(aggregateGeneralWeek(usage, mapping, period), daysByDow);

      const bill = priceTouBill(
        plan,
        agg,
        generalWeek,
        ANNUAL_DAYS,
        period,
        describeExtrapolation(agg),
      );

      // Both sampled days (TUE, WED) have exactly 1 occurrence each, so both get the identical
      // per-day-of-week factor 365/7 — the golden 20/38 peak/off-peak kWh split (ADR-0015) scales
      // by that one factor, not by the flat plan's 182.5 (365/2): the TOU model only projects the
      // 2 days of the week it actually measured, unlike the flat model's date-count ratio, which
      // implicitly assumes every day of the year resembles the 2 sampled ones. This divergence is
      // expected and is exactly what the "no General data for {days}" disclosure (Compare.svelte)
      // exists to explain.
      const factor = 365 / 7;
      const peakKwh = 20 * factor;
      const offpeakKwh = 38 * factor;
      const cl1Kwh = 4 * 182.5; // CL1's own category coverage (2 days) is unaffected by the DOW model
      const generationKwh = 8 * 182.5;
      const supplyCents = (110 + 5) * 365;
      const generalUsageCents = peakKwh * 50 + offpeakKwh * 25;
      const cl1Cents = cl1Kwh * 20;
      const solarCreditCents = generationKwh * 5;
      const expectedTotal = Math.round(
        supplyCents + generalUsageCents + cl1Cents - solarCreditCents,
      );

      expect(bill.bestCaseTotalCents).toBe(expectedTotal);
      expect(bill.bestCaseTotalCents).not.toBe(405150); // the pre-fix (blanket-factor) figure
      expect(bill.extrapolation).toEqual({ factor: 182.5, sampledDays: 2 });

      const peak = bill.bands?.find((b) => b.label === 'Peak');
      const offpeakWeekday = bill.bands?.find((b) => b.label === 'Off-peak (weekday)');
      expect(peak?.kwh).toBeCloseTo(peakKwh, 10);
      expect(offpeakWeekday?.kwh).toBeCloseTo(offpeakKwh, 10);
    },
  );

  it('band proportions match the unscaled sample here because both sampled days share equal (1x) coverage', () => {
    // This is not a general shape-preservation guarantee under extrapolation — it holds in this
    // specific fixture only because daysByDow.TUE === daysByDow.WED === 1, so both days receive
    // the identical per-day-of-week factor. scaleGeneralWeek's own tests above prove the factor
    // differs when day-of-week coverage is uneven, which is the case shape is NOT trivially
    // preserved by construction.
    const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
    const unscaledAgg = aggregateUsage(usage, mapping, period);
    const unscaledWeek = aggregateGeneralWeek(usage, mapping, period);
    const unscaledDays = daysInPeriod(period);
    const unscaledBill = priceTouBill(plan, unscaledAgg, unscaledWeek, unscaledDays, period);

    const scaledAgg = scaleCategoryUsage(unscaledAgg);
    const daysByDow = countGeneralDaysByDow(usage, mapping, period);
    const scaledWeek = scaleGeneralWeek(unscaledWeek, daysByDow);
    const scaledBill = priceTouBill(plan, scaledAgg, scaledWeek, ANNUAL_DAYS, period);

    const scaledTotal = scaledBill.bands!.reduce((sum, b) => sum + b.kwh, 0);
    const unscaledTotal = unscaledBill.bands!.reduce((sum, b) => sum + b.kwh, 0);
    scaledBill.bands!.forEach((band, i) => {
      const scaledShare = band.kwh / scaledTotal;
      const unscaledShare = unscaledBill.bands![i].kwh / unscaledTotal;
      expect(scaledShare).toBeCloseTo(unscaledShare, 10);
    });
  });
});
