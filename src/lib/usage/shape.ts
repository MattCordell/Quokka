import type { Register } from '../nem12';
import { parseWeekSlotKey } from '../calc';

/** Mean kWh per interval slot across all days of a register (feeds the sparkline preview). */
export function averageDayShape(register: Register): number[] {
  const sums = new Array<number>(register.intervalsPerDay).fill(0);
  for (const day of register.days) {
    for (let i = 0; i < register.intervalsPerDay; i++) {
      sums[i] += day.values[i] ?? 0;
    }
  }
  const dayCount = register.days.length || 1;
  return sums.map((sum) => sum / dayCount);
}

/**
 * Folds `aggregateGeneralWeek`'s day-of-week map down to a 24-length kWh-by-hour-of-day profile
 * (the Compare usage-shape chart, PRD §7.6). Each slot's kWh is attributed wholly to the hour
 * containing its *start* minute — the only well-defined choice for an interval whose length
 * doesn't divide 60 (e.g. 18 min, which the parser permits) — so the array always sums to the
 * same total as the input map, nothing dropped or double-counted.
 */
export function hourOfDayProfile(generalWeek: Map<string, number>): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const [key, kwh] of generalWeek) {
    const { minute } = parseWeekSlotKey(key);
    hours[Math.floor(minute / 60)] += kwh;
  }
  return hours;
}
