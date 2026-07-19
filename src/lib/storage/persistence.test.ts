import { describe, expect, it, beforeEach } from 'vitest';
import {
  SCHEMA_VERSION,
  saveUsage,
  loadUsage,
  saveMapping,
  loadMapping,
  listStoredNmis,
  clearAllUsage,
  savePlans,
  loadPlans,
} from './persistence';
import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import type { FlatPlan, TouPlan } from '../plan/types';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function usage(nmi: string): NmiData {
  return { nmi, registers: [], firstDate: '20250701', lastDate: '20250702', dayCount: 2 };
}

function mapping(nmi: string): RegisterMapping {
  return { nmi, registers: { E1: 'General' } };
}

function plan(id: string): FlatPlan {
  return {
    id,
    name: 'Test Plan',
    retailer: 'Test Co',
    type: 'flat_rate',
    supply: { generalCentsPerDay: 100, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    usage: { generalRateCentsPerKwh: 30 },
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
  };
}

function touPlan(id: string): TouPlan {
  return {
    id,
    name: 'Test TOU Plan',
    retailer: 'Test Co',
    type: 'time_of_use',
    supply: { generalCentsPerDay: 110, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    touBands: [
      {
        label: 'All week',
        startTime: '00:00',
        endTime: '24:00',
        rateCentsPerKwh: 25,
        days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      },
    ],
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
  };
}

describe('persistence', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('round-trips usage', () => {
    const data = usage('6407000000');
    expect(saveUsage(data, storage)).toEqual({ ok: true });
    expect(loadUsage('6407000000', storage)).toEqual(data);
  });

  it('round-trips mapping', () => {
    const data = mapping('6407000000');
    expect(saveMapping(data, storage)).toEqual({ ok: true });
    expect(loadMapping('6407000000', storage)).toEqual(data);
  });

  it('envelopes with schemaVersion and savedAt', () => {
    saveUsage(usage('6407000000'), storage);
    const raw = JSON.parse(storage.getItem('quokka:usage:6407000000') ?? '{}');
    expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof raw.savedAt).toBe('string');
  });

  it('lists stored NMIs', () => {
    saveUsage(usage('A'), storage);
    saveUsage(usage('B'), storage);
    expect(listStoredNmis(storage).sort()).toEqual(['A', 'B']);
  });

  it('clearAllUsage removes usage and mapping but leaves quokka:plans', () => {
    saveUsage(usage('A'), storage);
    saveMapping(mapping('A'), storage);
    savePlans([plan('plan-a')], storage);

    clearAllUsage({}, storage);

    expect(loadUsage('A', storage)).toBeNull();
    expect(loadMapping('A', storage)).toBeNull();
    expect(loadPlans(storage)).toEqual([plan('plan-a')]);
  });

  it('round-trips the plan library as a single list', () => {
    const plans = [plan('plan-a'), plan('plan-b')];
    expect(savePlans(plans, storage)).toEqual({ ok: true });
    expect(loadPlans(storage)).toEqual(plans);
  });

  it('loadPlans returns [] when nothing is stored', () => {
    expect(loadPlans(storage)).toEqual([]);
  });

  it('loadPlans returns [] for corrupt JSON or a bumped schemaVersion', () => {
    storage.setItem('quokka:plans', '{not json');
    expect(loadPlans(storage)).toEqual([]);

    storage.setItem(
      'quokka:plans',
      JSON.stringify({ schemaVersion: 999, savedAt: 'x', data: [plan('plan-a')] }),
    );
    expect(loadPlans(storage)).toEqual([]);
  });

  it('drops a malformed plan (e.g. a non-numeric rate) instead of surfacing a NaN bill', () => {
    const malformed = { ...plan('plan-bad'), usage: { generalRateCentsPerKwh: 'oops' } };
    storage.setItem(
      'quokka:plans',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        savedAt: 'x',
        data: [plan('plan-good'), malformed],
      }),
    );

    expect(loadPlans(storage)).toEqual([plan('plan-good')]);
  });

  it('round-trips a TOU plan alongside a flat plan in the same library', () => {
    const plans = [plan('plan-a'), touPlan('plan-tou')];
    expect(savePlans(plans, storage)).toEqual({ ok: true });
    expect(loadPlans(storage)).toEqual(plans);
  });

  it('drops a TOU plan with a shape-malformed band instead of surfacing a NaN bill', () => {
    const malformed = {
      ...touPlan('plan-tou-bad'),
      touBands: [{ ...touPlan('x').touBands[0], rateCentsPerKwh: 'oops' }],
    };
    storage.setItem(
      'quokka:plans',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        savedAt: 'x',
        data: [touPlan('plan-tou-good'), malformed],
      }),
    );

    expect(loadPlans(storage)).toEqual([touPlan('plan-tou-good')]);
  });

  it('drops a shape-valid TOU plan whose Band Coverage has a gap, re-validating beyond the editor save-time gate', () => {
    const gappy = {
      ...touPlan('plan-tou-gap'),
      touBands: [{ ...touPlan('x').touBands[0], endTime: '23:30' }], // misses the last 30 min of every day
    };
    storage.setItem(
      'quokka:plans',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        savedAt: 'x',
        data: [touPlan('plan-tou-good'), gappy],
      }),
    );

    expect(loadPlans(storage)).toEqual([touPlan('plan-tou-good')]);
  });

  it('clearAllUsage can leave mapping in place when includeMapping is false', () => {
    saveUsage(usage('A'), storage);
    saveMapping(mapping('A'), storage);

    clearAllUsage({ includeMapping: false }, storage);

    expect(loadUsage('A', storage)).toBeNull();
    expect(loadMapping('A', storage)).toEqual(mapping('A'));
  });

  it('returns null for a bumped schemaVersion', () => {
    storage.setItem(
      'quokka:usage:A',
      JSON.stringify({ schemaVersion: 999, savedAt: 'x', data: usage('A') }),
    );
    expect(loadUsage('A', storage)).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    storage.setItem('quokka:usage:A', '{not json');
    expect(loadUsage('A', storage)).toBeNull();
  });

  it('reports a quota error without throwing', () => {
    const quotaStorage: Storage = {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        const err = new Error('exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      },
    };

    expect(saveUsage(usage('A'), quotaStorage)).toEqual({
      ok: false,
      reason: 'quota',
      message: expect.any(String),
    });
  });
});
