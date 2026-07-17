import { describe, expect, it } from 'vitest';
import { compactToIso, dayInPeriod, daysInPeriod, isoToCompact } from './period';
import { CalcError } from './types';

describe('isoToCompact', () => {
  it('strips dashes', () => {
    expect(isoToCompact('2025-07-01')).toBe('20250701');
  });
});

describe('compactToIso', () => {
  it('inserts dashes', () => {
    expect(compactToIso('20250701')).toBe('2025-07-01');
  });

  it('round-trips with isoToCompact', () => {
    expect(compactToIso(isoToCompact('2025-07-01'))).toBe('2025-07-01');
  });
});

describe('dayInPeriod', () => {
  const period = { start: '2025-07-01', end: '2025-07-02' };

  it('includes both endpoints', () => {
    expect(dayInPeriod('20250701', period)).toBe(true);
    expect(dayInPeriod('20250702', period)).toBe(true);
  });

  it('excludes days outside the range', () => {
    expect(dayInPeriod('20250630', period)).toBe(false);
    expect(dayInPeriod('20250703', period)).toBe(false);
  });
});

describe('daysInPeriod', () => {
  it('is inclusive of both endpoints (ADR-0005 off-by-one)', () => {
    expect(daysInPeriod({ start: '2025-07-01', end: '2025-07-02' })).toBe(2);
  });

  it('is 1 for a single-day period', () => {
    expect(daysInPeriod({ start: '2025-07-01', end: '2025-07-01' })).toBe(1);
  });

  it('handles a month boundary', () => {
    expect(daysInPeriod({ start: '2025-07-31', end: '2025-08-01' })).toBe(2);
  });

  it('handles a full quarter', () => {
    expect(daysInPeriod({ start: '2025-01-01', end: '2025-03-31' })).toBe(90);
  });

  it('is immune to AU DST transitions (no local-timezone Date arithmetic)', () => {
    // AU eastern states end DST on the first Sunday in April; 2025-04-06 is that day.
    expect(daysInPeriod({ start: '2025-04-05', end: '2025-04-07' })).toBe(3);
  });

  it('throws rather than silently returning a negative day count for a reversed period', () => {
    expect(() => daysInPeriod({ start: '2025-07-02', end: '2025-07-01' })).toThrow(CalcError);
  });
});
