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
 */
export function aggregateUsage(
  usage: NmiData,
  mapping: RegisterMapping,
  period: Period,
): CategoryUsage {
  const kwhByCategory = emptyRecord(0);
  const mappedCategories = emptyRecord(false);
  let hasNonActualReads = false;

  for (const register of usage.registers) {
    const category = mapping.registers[register.registerId];
    if (!category || category === 'Ignore') continue;

    mappedCategories[category] = true;

    for (const day of register.days) {
      if (!dayInPeriod(day.date, period)) continue;

      for (let i = 0; i < day.values.length; i++) {
        const quality = day.quality[i];
        if (quality !== 'A') hasNonActualReads = true;
        kwhByCategory[category] += resolveIntervalKwh(quality, day.values[i]);
      }
    }
  }

  return { kwhByCategory, mappedCategories, hasNonActualReads };
}
