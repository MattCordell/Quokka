import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNem12 } from '../nem12';
import { averageDayShape } from './shape';

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
