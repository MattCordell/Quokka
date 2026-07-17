import { describe, expect, it } from 'vitest';
import { aggregateUsage } from './aggregate';
import type { NmiData, Register, RegisterDay } from '../nem12';
import type { RegisterMapping } from '../mapping/types';

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
