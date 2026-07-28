import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateUsage } from './aggregate';
import { parseNem12 } from '../nem12';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

function day(overrides: Partial<RegisterDay>): RegisterDay {
  const values = overrides.values ?? [1, 1];
  return {
    date: '20250701',
    values,
    quality: new Array(values.length).fill('A'),
    ...overrides,
  };
}

function register(overrides: Partial<Register>): Register {
  return {
    nmi: '6407000000',
    registerId: 'E1',
    nmiSuffix: 'E1',
    meterSerial: 'METER01',
    uom: 'kWh',
    intervalLength: 720,
    intervalsPerDay: 2,
    days: [day({})],
    totalKwh: 0,
    ...overrides,
  };
}

function nmiData(registers: Register[]): NmiData {
  return {
    nmi: '6407000000',
    registers,
    firstDate: '20250701',
    lastDate: '20250702',
    dayCount: 2,
  };
}

const period = { start: '2025-07-01', end: '2025-07-02' };

describe('aggregateUsage', () => {
  it('zeroes an N-quality interval regardless of its raw value, and flags non-actual reads', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        days: [day({ values: [1, 1], quality: ['A', 'N'] })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    const result = aggregateUsage(usage, mapping, period);

    expect(result.kwhByCategory.General).toBe(1);
    expect(result.hasNonActualReads).toBe(true);
  });

  it('sums substituted (F/S) values as-is and flags them as non-actual', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        days: [day({ values: [1, 2], quality: ['F', 'S'] })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    const result = aggregateUsage(usage, mapping, period);

    expect(result.kwhByCategory.General).toBe(3);
    expect(result.hasNonActualReads).toBe(true);
  });

  it('does not flag non-actual reads when every counted interval is actual', () => {
    const usage = nmiData([register({ registerId: 'E1' })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(aggregateUsage(usage, mapping, period).hasNonActualReads).toBe(false);
  });

  it('sums multiple registers sharing one category (ADR-0011)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ values: [1, 1] })] }),
      register({ registerId: 'E2', nmiSuffix: 'E2', days: [day({ values: [2, 2] })] }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', E2: 'General' },
    };

    expect(aggregateUsage(usage, mapping, period).kwhByCategory.General).toBe(6);
  });

  it('sums only days within the selected period, even when the file covers more', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        days: [
          day({ date: '20250701', values: [1, 1] }),
          day({ date: '20250705', values: [9, 9] }),
        ],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    const narrowPeriod = { start: '2025-07-01', end: '2025-07-01' };

    expect(aggregateUsage(usage, mapping, narrowPeriod).kwhByCategory.General).toBe(2);
  });

  it('excludes registers mapped to Ignore', () => {
    const usage = nmiData([register({ registerId: 'E1' })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'Ignore' } };

    const result = aggregateUsage(usage, mapping, period);

    expect(result.kwhByCategory.General).toBe(0);
    expect(result.mappedCategories.General).toBe(false);
  });

  it('excludes registers absent from the mapping', () => {
    const usage = nmiData([register({ registerId: 'E1' })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: {} };

    expect(aggregateUsage(usage, mapping, period).kwhByCategory.General).toBe(0);
  });

  it('marks a category mapped even when its kWh in this period is zero', () => {
    const usage = nmiData([register({ registerId: 'E3', days: [day({ values: [0, 0] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E3: 'CL1' } };

    const result = aggregateUsage(usage, mapping, period);

    expect(result.mappedCategories.CL1).toBe(true);
    expect(result.kwhByCategory.CL1).toBe(0);
  });
});

describe('aggregateUsage nonActualDayCount', () => {
  it('counts a single non-actual day', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ quality: ['A', 'N'] })] })]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(aggregateUsage(usage, mapping, period).nonActualDayCount).toBe(1);
  });

  it('dedupes the same date flagged across three registers (E1, B1, E3)', () => {
    const usage = nmiData([
      register({ registerId: 'E1', days: [day({ date: '20250701', quality: ['A', 'N'] })] }),
      register({
        registerId: 'B1',
        nmiSuffix: 'B1',
        days: [day({ date: '20250701', quality: ['F', 'F'] })],
      }),
      register({
        registerId: 'E3',
        nmiSuffix: 'E3',
        days: [day({ date: '20250701', quality: ['S', 'A'] })],
      }),
    ]);
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation', E3: 'CL1' },
    };

    expect(aggregateUsage(usage, mapping, period).nonActualDayCount).toBe(1);
  });

  it('counts two distinct non-actual dates as 2', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        days: [
          day({ date: '20250701', quality: ['A', 'N'] }),
          day({ date: '20250702', quality: ['N', 'A'] }),
        ],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(aggregateUsage(usage, mapping, period).nonActualDayCount).toBe(2);
  });

  it('still counts a day once when many intervals in it are non-actual', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        intervalsPerDay: 4,
        days: [day({ values: [1, 1, 1, 1], quality: ['N', 'N', 'F', 'S'] })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(aggregateUsage(usage, mapping, period).nonActualDayCount).toBe(1);
  });

  it('does not count an out-of-period non-actual day', () => {
    const usage = nmiData([
      register({
        registerId: 'E1',
        days: [day({ date: '20250705', quality: ['N', 'N'] })],
      }),
    ]);
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    expect(aggregateUsage(usage, mapping, period).nonActualDayCount).toBe(0);
  });

  it('does not count a non-actual day on an Ignore or unmapped register', () => {
    const usage = nmiData([register({ registerId: 'E1', days: [day({ quality: ['N', 'N'] })] })]);

    const ignoredMapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'Ignore' } };
    expect(aggregateUsage(usage, ignoredMapping, period).nonActualDayCount).toBe(0);

    const unmappedMapping: RegisterMapping = { nmi: '6407000000', registers: {} };
    expect(aggregateUsage(usage, unmappedMapping, period).nonActualDayCount).toBe(0);
  });

  it('invariant: hasNonActualReads === (nonActualDayCount > 0)', () => {
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };

    const clean = nmiData([register({ registerId: 'E1' })]);
    const cleanResult = aggregateUsage(clean, mapping, period);
    expect(cleanResult.hasNonActualReads).toBe(cleanResult.nonActualDayCount > 0);

    const flagged = nmiData([register({ registerId: 'E1', days: [day({ quality: ['A', 'N'] })] })]);
    const flaggedResult = aggregateUsage(flagged, mapping, period);
    expect(flaggedResult.hasNonActualReads).toBe(flaggedResult.nonActualDayCount > 0);
  });

  it('quality-mixed fixture proof: the 20250704 V-day is flagged on E1/B1/E3 but counts once', () => {
    const parsed = parseNem12(readFixture('nem12/nem12-quality-mixed.csv'));
    const usage = parsed.nmis[0];
    const mapping: RegisterMapping = {
      nmi: usage.nmi,
      registers: { E1: 'General', B1: 'Generation', E3: 'CL1' },
    };

    const result = aggregateUsage(usage, mapping, {
      start: '2025-07-04',
      end: '2025-07-04',
    });

    expect(result.nonActualDayCount).toBe(1);
  });
});
