import { CalcError, type Period } from './types';

/** "2025-07-01" -> "20250701", to compare against RegisterDay.date (NEM12's YYYYMMDD). */
export function isoToCompact(iso: string): string {
  return iso.replace(/-/g, '');
}

/** "20250701" -> "2025-07-01", for bounding/defaulting a date-range picker to the data span. */
export function compactToIso(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

/** Whether a RegisterDay.date ("YYYYMMDD") lies within `period`, inclusive of both endpoints. */
export function dayInPeriod(compactDate: string, period: Period): boolean {
  const start = isoToCompact(period.start);
  const end = isoToCompact(period.end);
  return compactDate >= start && compactDate <= end;
}

function toUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Calendar days in `period`, inclusive of both endpoints (ADR-0005): end - start + 1.
 * Computed via Date.UTC epoch difference so it's immune to local-timezone/DST drift.
 *
 * Validates start <= end itself rather than trusting callers: the engine is framework-agnostic
 * (ADR-0013) and shouldn't rely on a UI guard to keep a reversed range from silently producing
 * a negative day count and negative supply cents.
 */
export function daysInPeriod(period: Period): number {
  const startMs = toUtcMs(period.start);
  const endMs = toUtcMs(period.end);
  if (endMs < startMs) {
    throw new CalcError(`Period end (${period.end}) is before start (${period.start})`);
  }
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}
