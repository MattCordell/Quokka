import type { Register } from '../nem12';

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
