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
  expectedDaysByDow,
} from './billingPeriod';
import { aggregateUsage } from './aggregate';
import { aggregateGeneralWeek, priceTouBill } from './tou';
import { priceFlatBill } from './flat';
import { daysInPeriod, dayOfWeek, isoFromUtcMs, isoToCompact, toUtcMs } from './period';
import { parseNem12 } from '../nem12';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { CategoryUsage } from './types';
import type { FlatPlan, TouPlan } from '../plan/types';
import { CalcError } from './types';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

/** ISO date arithmetic, matching period.ts's own timezone-immune toUtcMs/isoFromUtcMs style. */
function isoPlusDays(iso: string, n: number): string {
  return isoFromUtcMs(toUtcMs(iso) + n * 86_400_000);
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

const EXPECTED_365_DOW = {
  MON: 52,
  TUE: 52,
  WED: 53,
  THU: 52,
  FRI: 52,
  SAT: 52,
  SUN: 52,
} as const;

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

    const scaled = scaleGeneralWeek(week, daysByDow, EXPECTED_365_DOW);

    expect(scaled.get('TUE|0')).toBe(10 * (52 / 1));
    expect(scaled.get('WED|0')).toBe(20 * (53 / 2));
    // Proof the two factors actually differ (this is what a blanket factor would get wrong):
    expect(scaled.get('TUE|0')! / 10).not.toBeCloseTo(scaled.get('WED|0')! / 20, 5);
  });

  it('does not scale a day of the week whose coverage already meets or exceeds its expected count', () => {
    const week = new Map([['TUE|0', 100]]);
    const daysByDow = { MON: 0, TUE: 53, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 } as const;

    expect(scaleGeneralWeek(week, daysByDow, EXPECTED_365_DOW).get('TUE|0')).toBe(100);
  });

  it('leaves a day of the week absent from the map absent after scaling — no data is fabricated', () => {
    const week = new Map([['TUE|0', 10]]);
    const daysByDow = { MON: 0, TUE: 1, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 } as const;

    const scaled = scaleGeneralWeek(week, daysByDow, EXPECTED_365_DOW);

    expect(scaled.has('MON|0')).toBe(false);
    expect([...scaled.keys()]).toEqual(['TUE|0']);
  });

  it('a gapless 365-day sample scales every slot by exactly 1 — no phantom inflation (round-2 finding #2)', () => {
    // Regression for the bug a uniform ANNUAL_DAYS/7 (52.142857...) constant caused: a real
    // calendar year is 52 weeks + 1 day, so six days-of-week occur 52 times and one occurs 53
    // times, never the fractional average. Feeding an actual, gapless 365-day sample's daysByDow
    // straight back in as expectedByDow (as expectedDaysByDow does when the period IS the
    // reference window) must therefore score every day at coverageFactor 1, not ~1.0027.
    const week = new Map([['TUE|0', 100]]);
    const daysByDow = { MON: 52, TUE: 52, WED: 53, THU: 52, FRI: 52, SAT: 52, SUN: 52 } as const;

    expect(scaleGeneralWeek(week, daysByDow, EXPECTED_365_DOW).get('TUE|0')).toBe(100);
  });
});

describe('expectedDaysByDow (ADR-0006)', () => {
  it('splits a 365-day reference year into six days at 52 occurrences and one at 53', () => {
    const period = { start: '2025-01-01', end: '2025-12-31' }; // 2025 is not a leap year
    const counts = expectedDaysByDow(period);

    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(365);
    expect(Object.values(counts).filter((n) => n === 53)).toHaveLength(1);
    expect(Object.values(counts).filter((n) => n === 52)).toHaveLength(6);
    // The day-of-week that gets the extra (53rd) occurrence is the one shared by both endpoints
    // of the reference year (a 365-day inclusive span puts its start and end 364 = 52*7 days
    // apart, so they always land on the same day-of-week).
    expect(counts[dayOfWeek(isoToCompact('2025-12-31'))]).toBe(53);
  });

  it('depends only on period.end, not period.start — a short sample still projects against a full calendar year', () => {
    const shortPeriod = { start: '2025-07-01', end: '2025-07-02' }; // the 2-day golden span
    const fullYearEndingSameDay = { start: '2024-07-03', end: '2025-07-02' };

    expect(expectedDaysByDow(shortPeriod)).toEqual(expectedDaysByDow(fullYearEndingSameDay));
  });

  it('matches the golden fixture reference window: TUE=52, WED=53, everything else 52', () => {
    const period = { start: '2025-07-01', end: '2025-07-02' };
    expect(expectedDaysByDow(period)).toEqual(EXPECTED_365_DOW);
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

  it('aggregateGeneralWeek finds exactly one Tuesday and one Wednesday, nothing else', () => {
    const { daysByDow } = aggregateGeneralWeek(usage, mapping, period);
    expect(daysByDow.TUE).toBe(1);
    expect(daysByDow.WED).toBe(1);
    expect(missingDaysOfWeek(daysByDow)).toEqual(['MON', 'THU', 'FRI', 'SAT', 'SUN']);
  });

  it('expectedDaysByDow for the golden span matches the real calendar year ending 2025-07-02: TUE=52, WED=53', () => {
    // TUE and WED both get sampled once (previous test), but they are NOT equally represented in
    // a real year — round-2 finding #2's fix — so they must not share one factor.
    expect(expectedDaysByDow(period)).toEqual(EXPECTED_365_DOW);
  });

  it(
    'prices the extrapolated TOU total from the actual per-day-of-week coverage against the ' +
      'real calendar split (52 Tuesdays, 53 Wednesdays), not a uniform 365/7 factor',
    () => {
      const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
      const agg = scaleCategoryUsage(aggregateUsage(usage, mapping, period));
      const { week, daysByDow } = aggregateGeneralWeek(usage, mapping, period);
      const generalWeek = scaleGeneralWeek(week, daysByDow, expectedDaysByDow(period));

      const bill = priceTouBill(
        plan,
        agg,
        generalWeek,
        ANNUAL_DAYS,
        period,
        describeExtrapolation(agg),
      );

      // Tuesday (1 sample) projects against 52 real Tuesdays in the reference year; Wednesday (1
      // sample) against 53 real Wednesdays — a different factor per day, not the flat plan's
      // uniform 182.5 (365/2). The TOU model only projects the 2 days of the week it actually
      // measured, unlike the flat model's date-count ratio, which implicitly assumes every day of
      // the year resembles the 2 sampled ones. This divergence is expected and is exactly what
      // Compare.svelte's missingDows exclusion (round-2 finding #1) exists to keep out of the
      // ranked comparison, rather than disclosed alongside a $0 TOU band as round 1 did.
      const peakKwh = 10 * 52 + 10 * 53; // 10 kWh/day peak on both the sampled Tue and Wed
      const offpeakKwh = 19 * 52 + 19 * 53; // 19 kWh/day off-peak on both
      const cl1Kwh = 4 * 182.5; // CL1's own category coverage (2 days) is unaffected by the DOW model
      const generationKwh = 8 * 182.5;
      const supplyCents = (110 + 5) * 365;
      const generalUsageCents = peakKwh * 50 + offpeakKwh * 25;
      const cl1Cents = cl1Kwh * 20;
      const solarCreditCents = generationKwh * 5;
      const expectedTotal = Math.round(
        supplyCents + generalUsageCents + cl1Cents - solarCreditCents,
      );

      expect(peakKwh).toBe(1050);
      expect(offpeakKwh).toBe(1995);
      expect(expectedTotal).toBe(151650); // $1516.50
      expect(bill.bestCaseTotalCents).toBe(expectedTotal);
      expect(bill.bestCaseTotalCents).not.toBe(405150); // the original blanket-factor bug
      expect(bill.bestCaseTotalCents).not.toBe(150954); // round 1's uniform-365/7-per-DOW bug
      expect(bill.extrapolation).toEqual({ factor: 182.5, sampledDays: 2 });

      const peak = bill.bands?.find((b) => b.label === 'Peak');
      const offpeakWeekday = bill.bands?.find((b) => b.label === 'Off-peak (weekday)');
      expect(peak?.kwh).toBeCloseTo(peakKwh, 10);
      expect(offpeakWeekday?.kwh).toBeCloseTo(offpeakKwh, 10);
    },
  );

  it('band proportions match the unscaled sample here because the sampled days share an identical daily shape', () => {
    // Not a general shape-preservation guarantee under extrapolation: TUE and WED get *different*
    // factors now (52 vs 53, previous test) — the ratio is preserved here only because the golden
    // fixture's Tuesday and Wednesday have identical peak/off-peak kWh (10/19 each), so both bands
    // scale by the same (factorTue + factorWed) combination regardless of the two factors
    // differing. A sample where the sampled days' shapes differ would not preserve the ratio.
    const plan = JSON.parse(readFixture('plans/tou-plan.json')) as TouPlan;
    const unscaledAgg = aggregateUsage(usage, mapping, period);
    const { week: unscaledWeek, daysByDow } = aggregateGeneralWeek(usage, mapping, period);
    const unscaledDays = daysInPeriod(period);
    const unscaledBill = priceTouBill(plan, unscaledAgg, unscaledWeek, unscaledDays, period);

    const scaledAgg = scaleCategoryUsage(unscaledAgg);
    const scaledWeek = scaleGeneralWeek(unscaledWeek, daysByDow, expectedDaysByDow(period));
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

describe('gapless-year regression (round-2 finding #2)', () => {
  it('a gapless 365-day General sample gets extrapolation:null and no DOW scaling end-to-end', () => {
    const start = '2025-01-01';
    const days: RegisterDay[] = [];
    for (let i = 0; i < 365; i++) {
      days.push({
        date: isoToCompact(isoPlusDays(start, i)),
        values: new Array(48).fill(1),
        quality: new Array(48).fill('A'),
      });
    }
    const register: Register = {
      nmi: '6407000000',
      registerId: 'E1',
      nmiSuffix: 'E1',
      meterSerial: 'METER01',
      uom: 'kWh',
      intervalLength: 30,
      intervalsPerDay: 48,
      days,
      totalKwh: 365 * 24,
    };
    const usage: NmiData = {
      nmi: '6407000000',
      registers: [register],
      firstDate: days[0].date,
      lastDate: days[days.length - 1].date,
      dayCount: days.length,
    };
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const period = { start, end: isoPlusDays(start, 364) };
    expect(daysInPeriod(period)).toBe(365);

    const agg = aggregateUsage(usage, mapping, period);
    expect(agg.daysWithData.General).toBe(365);
    expect(describeExtrapolation(agg)).toBeNull();

    const { week, daysByDow } = aggregateGeneralWeek(usage, mapping, period);
    const expectedByDow = expectedDaysByDow(period);
    // The sample's real per-day-of-week counts exactly match the reference year's, because the
    // reference window (ending at period.end) and the sampled period are the same 365 days.
    expect(daysByDow).toEqual(expectedByDow);

    const scaledWeek = scaleGeneralWeek(week, daysByDow, expectedByDow);
    for (const [key, kwh] of week) {
      expect(scaledWeek.get(key)).toBe(kwh); // factor 1 everywhere — no +0.23% inflation
    }
  });
});
