import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeCoverage,
  formatTime,
  normalizeInclusiveEnd,
  parseTime,
  slotInBand,
  validateBandCoverage,
} from './coverage';
import type { TouBand, TouPlan } from './types';

function band(overrides: Partial<TouBand> = {}): TouBand {
  return {
    label: 'Test band',
    startTime: '00:00',
    endTime: '24:00',
    rateCentsPerKwh: 20,
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    ...overrides,
  };
}

describe('parseTime / formatTime', () => {
  it('round-trips ordinary times', () => {
    expect(parseTime('16:00')).toBe(960);
    expect(formatTime(960)).toBe('16:00');
  });

  it('treats "24:00" as the 1440-minute end-of-day sentinel', () => {
    expect(parseTime('24:00')).toBe(1440);
    expect(formatTime(1440)).toBe('24:00');
  });

  it('wraps a negative minute into 00:00-23:59 instead of producing a sign artifact', () => {
    expect(formatTime(-1)).toBe('23:59');
  });
});

describe('slotInBand', () => {
  it('treats an equal start/end as a zero-length band, not a full-day wraparound', () => {
    expect(slotInBand(0, 960, 960)).toBe(false);
    expect(slotInBand(960, 960, 960)).toBe(false);
    expect(slotInBand(1439, 960, 960)).toBe(false);
  });
});

describe('normalizeInclusiveEnd (ADR-0001 editor-UX transform)', () => {
  it('rounds an inclusive end already on the grid up to the next exclusive mark', () => {
    expect(normalizeInclusiveEnd('20:59', 30)).toBe('21:00');
  });

  it('rounds an inclusive end mid-slot up to the covering slot boundary', () => {
    expect(normalizeInclusiveEnd('20:29', 30)).toBe('20:30');
  });

  it('rounds the last inclusive minute of the day to the "24:00" sentinel', () => {
    expect(normalizeInclusiveEnd('23:59', 30)).toBe('24:00');
  });
});

describe('analyzeCoverage', () => {
  it('accepts a single band covering the full week', () => {
    const result = analyzeCoverage([band()], 30);
    expect(result.ok).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.overlaps).toEqual([]);
  });

  it('names a deliberate gap', () => {
    const bands = [band({ startTime: '00:00', endTime: '23:30' })]; // misses the last 30 min of every day
    const result = analyzeCoverage(bands, 30);
    expect(result.ok).toBe(false);
    expect(result.gaps).toContainEqual({ day: 'MON', range: '23:30-24:00' });
    expect(result.gaps).toHaveLength(7);
  });

  it('names a deliberate overlap', () => {
    const bands = [
      band({ label: 'A', startTime: '00:00', endTime: '24:00' }),
      band({ label: 'B', startTime: '20:00', endTime: '21:00' }),
    ];
    const result = analyzeCoverage(bands, 30);
    expect(result.ok).toBe(false);
    expect(result.overlaps).toContainEqual({ day: 'MON', range: '20:00-21:00' });
  });

  it('handles a midnight-wrapping band assigned to the same calendar day', () => {
    const bands = [
      band({ label: 'Peak', startTime: '16:00', endTime: '21:00', days: ['MON'] }),
      band({ label: 'Off-peak', startTime: '21:00', endTime: '16:00', days: ['MON'] }),
    ];
    const result = analyzeCoverage(bands, 30);
    // Only MON has any band, so the other 6 days are gaps; MON itself is fully covered by
    // the wrapping pair (Peak 16:00-21:00 + Off-peak wrapping 21:00->16:00 on the same day).
    expect(result.grid[0].every((cell) => cell >= 0)).toBe(true);
    expect(result.gaps.filter((g) => g.day === 'MON')).toEqual([]);
  });

  it('does not self-overlap when a band lists the same day twice', () => {
    const bands = [band({ days: ['MON', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] })];
    const result = analyzeCoverage(bands, 30);
    expect(result.ok).toBe(true);
    expect(result.overlaps).toEqual([]);
  });

  it('rejects a boundary that does not align to the grid', () => {
    const bands = [band({ label: 'Misaligned', startTime: '16:15', endTime: '24:00' })];
    const result = analyzeCoverage(bands, 30);
    expect(result.ok).toBe(false);
    expect(result.misaligned).toEqual(['Misaligned']);
  });

  it('tiles weekday-vs-weekend day lists into full 168h coverage with no gap or overlap', () => {
    const bands: TouBand[] = [
      {
        label: 'Peak',
        startTime: '16:00',
        endTime: '21:00',
        rateCentsPerKwh: 50,
        days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      },
      {
        label: 'Off-peak (weekday)',
        startTime: '21:00',
        endTime: '16:00',
        rateCentsPerKwh: 25,
        days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      },
      {
        label: 'Off-peak (weekend)',
        startTime: '00:00',
        endTime: '24:00',
        rateCentsPerKwh: 25,
        days: ['SAT', 'SUN'],
      },
    ];
    expect(validateBandCoverage(bands, 30)).toBe(true);
  });

  it('validates the golden tou-plan.json fixture', () => {
    const plan = JSON.parse(
      readFileSync(new URL('../../../fixtures/plans/tou-plan.json', import.meta.url), 'utf-8'),
    ) as TouPlan;
    expect(validateBandCoverage(plan.touBands, 30)).toBe(true);
  });
});
