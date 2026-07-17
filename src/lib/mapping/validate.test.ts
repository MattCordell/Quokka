import { describe, expect, it } from 'vitest';
import { validateMapping } from './validate';
import type { Register } from '../nem12';
import type { RegisterMapping } from './types';

function register(overrides: Partial<Register>): Register {
  return {
    nmi: '6407000000',
    registerId: 'E1',
    nmiSuffix: 'E1',
    meterSerial: 'METERGEN01',
    uom: 'kWh',
    intervalLength: 30,
    intervalsPerDay: 48,
    days: [],
    totalKwh: 0,
    ...overrides,
  };
}

describe('validateMapping', () => {
  it('passes the golden mapping (one register per priced category)', () => {
    const registers = [
      register({ registerId: 'E1' }),
      register({ registerId: 'B1', nmiSuffix: 'B1', meterSerial: 'METERGEN01' }),
      register({ registerId: 'E3', nmiSuffix: 'E3', meterSerial: 'METERCL01' }),
    ];
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', B1: 'Generation', E3: 'CL1' },
    };

    expect(validateMapping(registers, mapping)).toEqual({ ok: true, issues: [] });
  });

  it('flags mismatched interval lengths within one category, naming both registers', () => {
    const registers = [
      register({ registerId: 'E1', intervalLength: 30 }),
      register({ registerId: 'E2', nmiSuffix: 'E2', intervalLength: 5 }),
    ];
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'General', E2: 'General' },
    };

    const result = validateMapping(registers, mapping);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ type: 'interval-length', category: 'General' });
    expect(result.issues[0].registerIds).toEqual(['E1', 'E2']);
  });

  it('allows an Ignore-only mapping', () => {
    const registers = [
      register({ registerId: 'E1' }),
      register({ registerId: 'E2', nmiSuffix: 'E2' }),
    ];
    const mapping: RegisterMapping = {
      nmi: '6407000000',
      registers: { E1: 'Ignore', E2: 'Ignore' },
    };
    expect(validateMapping(registers, mapping)).toEqual({ ok: true, issues: [] });
  });

  it('allows a category with zero registers (unassigned)', () => {
    const registers = [register({ registerId: 'E1' })];
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    expect(validateMapping(registers, mapping)).toEqual({ ok: true, issues: [] });
  });

  it('never flags a category with a single register', () => {
    const registers = [register({ registerId: 'E1', intervalLength: 30 })];
    const mapping: RegisterMapping = { nmi: '6407000000', registers: { E1: 'General' } };
    expect(validateMapping(registers, mapping)).toEqual({ ok: true, issues: [] });
  });
});
