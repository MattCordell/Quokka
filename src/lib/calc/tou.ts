import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { TouPlan, TouDay } from '../plan/types';
import { parseTime, slotInBand } from '../plan/coverage';
import type { Bill, BandCharge, CategoryUsage, Period } from './types';
import { daysInPeriod, dayInPeriod, dayOfWeek } from './period';
import { aggregateUsage } from './aggregate';
import { finalizeTotal, priceSupplyClSolar, resolveIntervalKwh } from './common';

function weekSlotKey(day: TouDay, minute: number): string {
  return `${day}|${minute}`;
}

function parseWeekSlotKey(key: string): { day: TouDay; minute: number } {
  const [day, minute] = key.split('|');
  return { day: day as TouDay, minute: Number(minute) };
}

/**
 * A plan-independent weekly profile of General kWh, keyed by `${TouDay}|${startMinute}` (the
 * interval's own day-of-week and minute-of-day). Registers mapped to General are summed
 * (ADR-0011); `quality === 'N'` zeroes that interval, matching aggregateUsage's rule. Computed
 * once so multiple TOU plans can be priced against the same profile (mirrors the
 * aggregate-once/price-many split aggregateUsage already gives flat plans).
 */
export function aggregateGeneralWeek(
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): Map<string, number> {
  const week = new Map<string, number>();

  for (const register of usage.registers) {
    if (mapping.registers[register.registerId] !== 'General') continue;

    for (const day of register.days) {
      if (!dayInPeriod(day.date, period)) continue;
      const dow = dayOfWeek(day.date);

      for (let i = 0; i < day.values.length; i++) {
        const kwh = resolveIntervalKwh(day.quality[i], day.values[i]);
        const key = weekSlotKey(dow, i * register.intervalLength);
        week.set(key, (week.get(key) ?? 0) + kwh);
      }
    }
  }

  return week;
}

/**
 * Prices a TOU Plan against an already-aggregated CategoryUsage + weekly General profile.
 * Each (day, minute) slot is assigned to the single band whose days include that day-of-week
 * and whose half-open [start,end) contains that minute (ADR-0001) — the same slotInBand test
 * coverage validation uses, so a plan that passed Band Coverage has no unassigned slot here.
 */
export function priceTouBill(
  plan: TouPlan,
  agg: CategoryUsage,
  generalWeek: Map<string, number>,
  days: number,
  period: Period,
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
    // Coverage is validated at the editor's save gate and re-checked on every storage load
    // (persistence.ts's loadPlans), so this should be unreachable in practice; left as a
    // defense-in-depth skip rather than a throw, so an in-memory plan object bypassing both
    // gates still renders a partial bill instead of crashing the Compare screen.
    if (bandIndex !== -1) bandKwh[bandIndex] += kwh;
  }

  const bands: BandCharge[] = plan.touBands.map((band, i) => ({
    label: band.label,
    kwh: bandKwh[i],
    rateCentsPerKwh: band.rateCentsPerKwh,
    cents: bandKwh[i] * band.rateCentsPerKwh,
  }));
  const generalUsageCents = bands.reduce((sum, b) => sum + b.cents, 0);

  const totalCents = finalizeTotal(
    [supplyCents, generalUsageCents, cl1Cents, cl2Cents],
    solarCreditCents,
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
    totalCents,
    hasNonActualReads: agg.hasNonActualReads,
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
  const generalWeek = aggregateGeneralWeek(usage, mapping, period);
  return priceTouBill(plan, agg, generalWeek, days, period);
}
