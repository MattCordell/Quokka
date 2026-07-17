import { describe, expect, it } from 'vitest';
import { reconcileMapping } from './reconcile';
import type { NmiData, Register } from '../nem12';
import type { RegisterMapping } from './types';

function register(registerId: string): Register {
  return {
    nmi: '6407000000',
    registerId,
    nmiSuffix: registerId,
    meterSerial: `METER-${registerId}`,
    uom: 'kWh',
    intervalLength: 30,
    intervalsPerDay: 48,
    days: [],
    totalKwh: 0,
  };
}

function nmiData(registerIds: string[]): NmiData {
  return {
    nmi: '6407000000',
    registers: registerIds.map(register),
    firstDate: '20250701',
    lastDate: '20250702',
    dayCount: 2,
  };
}

describe('reconcileMapping', () => {
  const goldenMapping: RegisterMapping = {
    nmi: '6407000000',
    registers: { E1: 'General', B1: 'Generation', E3: 'CL1' },
  };

  it('adopts stored categories unchanged when registers match', () => {
    const data = nmiData(['E1', 'B1', 'E3']);
    expect(reconcileMapping(goldenMapping, data)).toEqual(goldenMapping);
  });

  it('defaults a new register not present in the stored mapping to Ignore', () => {
    const data = nmiData(['E1', 'B1', 'E3', 'E4']);
    const result = reconcileMapping(goldenMapping, data);
    expect(result.registers.E4).toBe('Ignore');
    expect(result.registers.E1).toBe('General');
  });

  it('drops a stored register no longer present in the file', () => {
    const data = nmiData(['E1', 'B1']);
    const result = reconcileMapping(goldenMapping, data);
    expect(result.registers).toEqual({ E1: 'General', B1: 'Generation' });
  });

  it('defaults every register to Ignore when there is no stored mapping', () => {
    const data = nmiData(['E1']);
    expect(reconcileMapping(null, data)).toEqual({
      nmi: '6407000000',
      registers: { E1: 'Ignore' },
    });
  });
});
