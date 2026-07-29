import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import { TOU_DAYS, type TouPlan, type TouDay } from '../plan/types';
import { formatTime, parseTime, slotInBand } from '../plan/coverage';
import { CalcError, type Bill, type BandCharge, type CategoryUsage, type Period } from './types';
import { daysInPeriod, dayInPeriod, dayOfWeek } from './period';
import { aggregateUsage } from './aggregate';
import { finalizeBill, priceSupplyClSolar, resolveIntervalKwh } from './common';
import { priceDiscounts } from './discount';

// Matches the fixed grid Band Coverage is validated against (plan/coverage.ts's default
// intervalMinutes). A 30-min-aligned band boundary can only ever fall on an interval edge, never
// strictly inside one, if the interval length itself divides 30 (e.g. 1/5/10/15/30 min — the
// lengths conformant NEM12 data actually uses). A length that's merely <= 30 but doesn't divide
// it (16/18/20/24 min, all still valid per the parser's `1440 % len === 0` check) can straddle
// an odd-half-hour boundary and get mis-assigned, so the guard checks divisibility, not size.
const TOU_COVERAGE_GRID_MINUTES = 30;

function weekSlotKey(day: TouDay, minute: number): string {
  return `${day}|${minute}`;
}

export function parseWeekSlotKey(key: string): { day: TouDay; minute: number } {
  const [day, minute] = key.split('|');
  return { day: day as TouDay, minute: Number(minute) };
}

/**
 * A plan-independent weekly profile of General kWh, keyed by `${TouDay}|${startMinute}` (the
 * interval's own day-of-week and minute-of-day), plus the distinct in-period dates behind it,
 * bucketed by day-of-week (deduped across General registers, matching the `week` map's own
 * dedup). Registers mapped to General are summed (ADR-0011); `quality === 'N'` zeroes that
 * interval, matching aggregateUsage's rule. `daysByDow` is the actual sample size behind each
 * day-of-week's slice of `week` — annual extrapolation (ADR-0006, `scaleGeneralWeek`) needs it
 * per-day-of-week rather than as one combined day count, because a short or unevenly-distributed
 * sample doesn't represent every weekday/weekend day equally (e.g. a 2-day sample covering only a
 * Tuesday and a Wednesday has zero data for the other five days of the week — no scaling factor
 * can manufacture what was never measured). Both are returned from one pass over the registers
 * (rather than two separate functions each re-walking the same data) so multiple TOU plans can be
 * priced against the same profile (mirrors the aggregate-once/price-many split aggregateUsage
 * already gives flat plans).
 */
export function aggregateGeneralWeek(
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): { week: Map<string, number>; daysByDow: Record<TouDay, number> } {
  const week = new Map<string, number>();
  const datesByDow = Object.fromEntries(TOU_DAYS.map((day) => [day, new Set<string>()])) as Record<
    TouDay,
    Set<string>
  >;

  for (const register of usage.registers) {
    if (mapping.registers[register.registerId] !== 'General') continue;
    if (TOU_COVERAGE_GRID_MINUTES % register.intervalLength !== 0) {
      throw new CalcError(
        `Register ${register.registerId} has a ${register.intervalLength}-min interval, which ` +
          `does not divide the ${TOU_COVERAGE_GRID_MINUTES}-min TOU coverage grid; a band ` +
          `boundary could fall inside a single interval instead of on its edge.`,
      );
    }

    for (const day of register.days) {
      if (!dayInPeriod(day.date, period)) continue;
      const dow = dayOfWeek(day.date);
      datesByDow[dow].add(day.date);

      for (let i = 0; i < day.values.length; i++) {
        const kwh = resolveIntervalKwh(day.quality[i], day.values[i]);
        const key = weekSlotKey(dow, i * register.intervalLength);
        week.set(key, (week.get(key) ?? 0) + kwh);
      }
    }
  }

  const daysByDow = Object.fromEntries(
    TOU_DAYS.map((day) => [day, datesByDow[day].size]),
  ) as Record<TouDay, number>;

  return { week, daysByDow };
}

/**
 * Prices a TOU Plan against an already-aggregated CategoryUsage + weekly General profile.
 * Each (day, minute) slot is assigned to the single band whose days include that day-of-week
 * and whose half-open [start,end) contains that minute (ADR-0001) — the same slotInBand test
 * coverage validation uses, so a plan that passed Band Coverage has no unassigned slot here.
 *
 * `extrapolation` is opaque passthrough metadata (ADR-0006), same contract as `priceFlatBill`'s.
 */
export function priceTouBill(
  plan: TouPlan,
  agg: CategoryUsage,
  generalWeek: Map<string, number>,
  days: number,
  period: Period,
  extrapolation: Bill['extrapolation'] = null,
): Bill {
  const { supplyCents, cl1Applicable, cl1Cents, cl2Applicable, cl2Cents, solarCreditCents } =
    priceSupplyClSolar(plan, agg, days);

  const bandTimes = plan.touBands.map((band) => ({
    start: parseTime(band.startTime),
    end: parseTime(band.endTime),
  }));
  const bandKwh = plan.touBands.map(() => 0);

  for (const [key, kwh] of generalWeek) {
    const { day, minute } = parseWeekSlotKey(key);
    const bandIndex = plan.touBands.findIndex(
      (band, i) =>
        band.days.includes(day) && slotInBand(minute, bandTimes[i].start, bandTimes[i].end),
    );
    // The engine enforces its own contract rather than trusting a caller's UI gate (mirrors
    // daysInPeriod throwing CalcError on a reversed period, calc/period.ts): silently under-
    // counting kWh here would understate the bill with no signal, which is worse for a money
    // tool than refusing to price. Callers (e.g. Compare.svelte) are responsible for excluding
    // a plan whose Band Coverage is invalid before calling this, and showing that separately.
    if (bandIndex === -1) {
      throw new CalcError(
        `No TOU band covers ${day} ${formatTime(minute)} for plan '${plan.name}' — its Band ` +
          `Coverage should be validated before pricing.`,
      );
    }
    bandKwh[bandIndex] += kwh;
  }

  const bands: BandCharge[] = plan.touBands.map((band, i) => ({
    label: band.label,
    kwh: bandKwh[i],
    rateCentsPerKwh: band.rateCentsPerKwh,
    cents: bandKwh[i] * band.rateCentsPerKwh,
  }));
  const generalUsageCents = bands.reduce((sum, b) => sum + b.cents, 0);

  const discounts = priceDiscounts(plan.discounts, {
    supplyCents,
    usageCents: generalUsageCents + cl1Cents + cl2Cents,
  });
  const totals = finalizeBill(
    [supplyCents, generalUsageCents, cl1Cents, cl2Cents],
    solarCreditCents,
    discounts,
  );

  return {
    planId: plan.id,
    period,
    daysInPeriod: days,
    supplyCents,
    generalUsageCents,
    bands,
    cl1Applicable,
    cl1Cents,
    cl2Applicable,
    cl2Cents,
    solarCreditCents,
    ...totals,
    discountLines: discounts.lines,
    hasNonActualReads: agg.hasNonActualReads,
    nonActualDayCount: agg.nonActualDayCount,
    extrapolation,
  };
}

/** Convenience one-shot: aggregates usage and prices a single TOU plan in one call. */
export function computeTouBill(
  plan: TouPlan,
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): Bill {
  const days = daysInPeriod(period);
  const agg = aggregateUsage(usage, mapping, period);
  const { week } = aggregateGeneralWeek(usage, mapping, period);
  return priceTouBill(plan, agg, week, days, period);
}
