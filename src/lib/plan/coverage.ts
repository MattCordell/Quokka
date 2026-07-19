import { TOU_DAYS, type TouBand, type TouDay } from './types';

const MINUTES_PER_DAY = 1440;

/** "HH:MM" -> minutes since midnight; "24:00" is the end-of-day sentinel (1440). */
export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * minutes since midnight -> "HH:MM"; 1440 formats back to the "24:00" sentinel. Wraps any
 * other integer (including negative, e.g. from a "covers up to end-1" display computation)
 * into the 00:00-23:59 range rather than producing a sign or padding artifact.
 */
export function formatTime(minutes: number): string {
  if (minutes === MINUTES_PER_DAY) return '24:00';
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * ADR-0001 editor-UX: a user-friendly *inclusive* end ("20:59", "ends at 9pm") normalises to
 * the *exclusive* grid boundary actually stored ("21:00"). Rounds up to the next grid mark,
 * since an inclusive end of e.g. "20:29" still means the 20:00-20:30 slot is covered.
 */
export function normalizeInclusiveEnd(inclusiveHHMM: string, intervalMinutes = 30): string {
  const inclusiveMinute = parseTime(inclusiveHHMM) + 1;
  const exclusiveMinute = Math.ceil(inclusiveMinute / intervalMinutes) * intervalMinutes;
  return formatTime(exclusiveMinute);
}

/**
 * Whether the slot starting at `slotMinute` falls in the band's half-open [start,end),
 * wrapping midnight if start > end (ADR-0001). Shared by coverage validation here and by
 * TOU pricing's interval assignment (calc/tou.ts), so both use identical band-membership
 * logic. An equal start/end is a zero-length band (covers nothing) — without this check it
 * would fall into the wraparound branch and match every slot, the opposite of empty.
 */
export function slotInBand(slotMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return slotMinute >= startMinute && slotMinute < endMinute;
  return slotMinute >= startMinute || slotMinute < endMinute;
}

/** -1 = uncovered (Gap), -2 = covered by more than one band (Overlap), else the covering band's index. */
export const GAP = -1;
export const OVERLAP = -2;

export interface CoverageIssue {
  day: TouDay;
  /** Inclusive display range, e.g. "02:00-02:30". */
  range: string;
}

export interface CoverageResult {
  ok: boolean;
  /** grid[day index 0=MON..6=SUN][slot index] = GAP | OVERLAP | band index. */
  grid: number[][];
  gaps: CoverageIssue[];
  overlaps: CoverageIssue[];
  /** Labels of bands whose startTime/endTime isn't a multiple of intervalMinutes. */
  misaligned: string[];
}

function coalesce(day: TouDay, slots: boolean[], intervalMinutes: number): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= slots.length; i++) {
    const flagged = i < slots.length && slots[i];
    if (flagged && runStart === null) {
      runStart = i;
    } else if (!flagged && runStart !== null) {
      const startMinute = runStart * intervalMinutes;
      const endMinute = i * intervalMinutes;
      issues.push({ day, range: `${formatTime(startMinute)}-${formatTime(endMinute)}` });
      runStart = null;
    }
  }
  return issues;
}

/**
 * Validates Band Coverage (glossary.md): every interval-length slot of all 168 weekly hours
 * must be covered by exactly one band (ADR-0001). Checked on a fixed grid (default 30 min,
 * safe against 5/15/30-min register data alike — a finer register interval never splits a
 * grid slot; the engine assigns against the register's own interval at pricing time).
 */
export function analyzeCoverage(bands: TouBand[], intervalMinutes = 30): CoverageResult {
  const slotsPerDay = MINUTES_PER_DAY / intervalMinutes;
  const grid: number[][] = TOU_DAYS.map(() => new Array<number>(slotsPerDay).fill(GAP));
  const misaligned: string[] = [];

  bands.forEach((band, bandIndex) => {
    const startMinute = parseTime(band.startTime);
    const endMinute = parseTime(band.endTime);
    if (startMinute % intervalMinutes !== 0 || endMinute % intervalMinutes !== 0) {
      misaligned.push(band.label);
      return;
    }
    for (const day of new Set(band.days)) {
      const dayIndex = TOU_DAYS.indexOf(day);
      for (let slot = 0; slot < slotsPerDay; slot++) {
        if (!slotInBand(slot * intervalMinutes, startMinute, endMinute)) continue;
        grid[dayIndex][slot] = grid[dayIndex][slot] === GAP ? bandIndex : OVERLAP;
      }
    }
  });

  const gaps: CoverageIssue[] = [];
  const overlaps: CoverageIssue[] = [];
  TOU_DAYS.forEach((day, dayIndex) => {
    gaps.push(
      ...coalesce(
        day,
        grid[dayIndex].map((v) => v === GAP),
        intervalMinutes,
      ),
    );
    overlaps.push(
      ...coalesce(
        day,
        grid[dayIndex].map((v) => v === OVERLAP),
        intervalMinutes,
      ),
    );
  });

  return {
    ok: gaps.length === 0 && overlaps.length === 0 && misaligned.length === 0,
    grid,
    gaps,
    overlaps,
    misaligned,
  };
}

/** Thin ok-only wrapper over analyzeCoverage, for callers that don't need the full detail. */
export function validateBandCoverage(bands: TouBand[], intervalMinutes = 30): boolean {
  return analyzeCoverage(bands, intervalMinutes).ok;
}
