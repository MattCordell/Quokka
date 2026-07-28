import type { NmiData } from '../nem12';
import { USAGE_CATEGORIES, type RegisterMapping, type UsageCategory } from '../mapping/types';
import type { CategoryUsage, Period } from './types';
import { dayInPeriod } from './period';
import { resolveIntervalKwh } from './common';

function emptyRecord<T>(value: T): Record<UsageCategory, T> {
  return Object.fromEntries(USAGE_CATEGORIES.map((category) => [category, value])) as Record<
    UsageCategory,
    T
  >;
}

/**
 * Sums kWh per Usage Category over `period` (ADR-0003, ADR-0011). Registers are grouped by
 * their mapped category (many registers may share one, ADR-0011); unmapped/`Ignore` registers
 * are excluded entirely. A `quality` flag of `'N'` zeroes that interval regardless of its raw
 * value; every other flag (including substituted `F`/`S`) is summed as-is, and any flag other
 * than `'A'` sets `hasNonActualReads` (ADR-0003) — computed over the selected period only.
 *
 * `nonActualDayCount` counts distinct in-period days where any counted interval resolved to a
 * non-'A' flag — one flagged interval marks the whole day. Generation counts too: an estimated
 * export day distorts the solar credit the same way a General estimate distorts usage. Dedup is
 * cross-register (a `Set<string>` of `day.date`): the same calendar day can appear on more than
 * one mapped register (e.g. General + Generation + CL1), and must still count once.
 *
 * `daysWithData` counts, **per category**, distinct in-period days present at all (any quality
 * flag) on that category's own mapped registers — a coverage count, not a quality count, kept
 * per-category rather than unioned across categories so a fully-covered register (e.g. solar
 * Generation) can never mask a gap in a different category (e.g. a General meter swap) that
 * happens to share the same period.
 */
export function aggregateUsage(
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): CategoryUsage {
  const kwhByCategory = emptyRecord(0);
  const mappedCategories = emptyRecord(false);
  let hasNonActualReads = false;
  const nonActualDays = new Set<string>();
  const daysWithDataByCategory = Object.fromEntries(
    USAGE_CATEGORIES.map((category) => [category, new Set<string>()]),
  ) as Record<UsageCategory, Set<string>>;

  for (const register of usage.registers) {
    const category = mapping.registers[register.registerId];
    if (!category || category === 'Ignore') continue;

    mappedCategories[category] = true;

    for (const day of register.days) {
      if (!dayInPeriod(day.date, period)) continue;
      daysWithDataByCategory[category].add(day.date);

      for (let i = 0; i < day.values.length; i++) {
        const quality = day.quality[i];
        if (quality !== 'A') {
          hasNonActualReads = true;
          nonActualDays.add(day.date);
        }
        kwhByCategory[category] += resolveIntervalKwh(quality, day.values[i]);
      }
    }
  }

  return {
    kwhByCategory,
    mappedCategories,
    hasNonActualReads,
    nonActualDayCount: nonActualDays.size,
    daysWithData: Object.fromEntries(
      USAGE_CATEGORIES.map((category) => [category, daysWithDataByCategory[category].size]),
    ) as Record<UsageCategory, number>,
  };
}
