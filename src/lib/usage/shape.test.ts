import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNem12 } from '../nem12';
import { averageDayShape, hourOfDayProfile } from './shape';

function readFixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/nem12/${name}`, import.meta.url), 'utf-8');
}

describe('averageDayShape', () => {
  const parsed = parseNem12(readFixture('nem12-golden.csv'));
  const [nmi] = parsed.nmis;
  const e1 = nmi.registers.find((r) => r.registerId === 'E1')!;

  it('has length intervalsPerDay', () => {
    expect(averageDayShape(e1)).toHaveLength(e1.intervalsPerDay);
  });

  it('averages match the golden fixture (its two days are identical)', () => {
    const shape = averageDayShape(e1);
    expect(shape).toEqual(e1.days[0].values);
    expect(shape).toEqual(e1.days[1].values);
    expect(shape[0]).toBeCloseTo(0.5);
    expect(shape.slice(32, 42)).toEqual(new Array(10).fill(1.0));
  });
});

describe('hourOfDayProfile', () => {
  it('folds a 30-min-slotted week map to 24 hourly buckets, summing across days-of-week', () => {
    const week = new Map<string, number>([
      ['MON|0', 1],
      ['MON|30', 2],
      ['TUE|0', 3],
    ]);

    const profile = hourOfDayProfile(week);

    expect(profile).toHaveLength(24);
    expect(profile[0]).toBe(1 + 2 + 3); // both MON slots and TUE's slot all fall in hour 0
  });

  it('folds a 5-min-slotted week map correctly', () => {
    const week = new Map<string, number>([
      ['MON|300', 1], // 05:00 -> hour 5
      ['MON|305', 1], // 05:05 -> hour 5
      ['MON|360', 1], // 06:00 -> hour 6
    ]);

    const profile = hourOfDayProfile(week);

    expect(profile[5]).toBe(2);
    expect(profile[6]).toBe(1);
  });

  it('preserves the total sum of the input map', () => {
    const week = new Map<string, number>([
      ['MON|0', 0.5],
      ['WED|750', 1.25],
      ['SUN|1430', 3],
    ]);

    const profile = hourOfDayProfile(week);
    const total = [...week.values()].reduce((a, b) => a + b, 0);

    expect(profile.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 10);
  });

  it('returns 24 zeros for an empty map', () => {
    expect(hourOfDayProfile(new Map())).toEqual(new Array(24).fill(0));
  });

  it('attributes an 18-min-interval slot straddling an hour boundary to its start hour', () => {
    // A slot starting at minute 54 (e.g. the 4th 18-min slot of the day: 0,18,36,54) still falls
    // in hour 0 even though it runs past the 60-min mark into hour 1.
    const week = new Map<string, number>([['MON|54', 2]]);

    const profile = hourOfDayProfile(week);

    expect(profile[0]).toBe(2);
    expect(profile[1]).toBe(0);
  });
});
