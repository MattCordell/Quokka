import { describe, expect, it, beforeEach } from 'vitest';
import {
  SCHEMA_VERSION,
  saveUsage,
  loadUsage,
  saveMapping,
  loadMapping,
  listStoredNmis,
  clearAllUsage,
} from './persistence';
import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';

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
    storage.setItem('quokka:plans', '{"kept":true}');

    clearAllUsage({}, storage);

    expect(loadUsage('A', storage)).toBeNull();
    expect(loadMapping('A', storage)).toBeNull();
    expect(storage.getItem('quokka:plans')).toBe('{"kept":true}');
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
