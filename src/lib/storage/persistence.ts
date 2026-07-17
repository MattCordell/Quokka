/**
 * Framework-agnostic on-device persistence (ADR-0008). Storage is dependency-injected
 * (defaults to globalThis.localStorage) so this module unit-tests without a DOM.
 *
 * Key namespaces are kept separate so "clear my usage data" can be surgical:
 *   quokka:usage:<NMI>   - envelope over NmiData
 *   quokka:mapping:<NMI> - envelope over RegisterMapping
 *   quokka:plans         - envelope over the whole Plan[] library; clearAllUsage never touches it
 */
import type { NmiData } from '../nem12';
import type { RegisterMapping } from '../mapping/types';
import { isValidPlan, type Plan } from '../plan/types';

export const SCHEMA_VERSION = 1;

interface Envelope<T> {
  schemaVersion: number;
  savedAt: string;
  data: T;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'error'; message: string };

const USAGE_PREFIX = 'quokka:usage:';
const MAPPING_PREFIX = 'quokka:mapping:';
const PLANS_KEY = 'quokka:plans';

function defaultStorage(): Storage {
  return globalThis.localStorage;
}

function save<T>(key: string, data: T, storage: Storage): SaveResult {
  const envelope: Envelope<T> = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  };
  try {
    storage.setItem(key, JSON.stringify(envelope));
    return { ok: true };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'QuotaExceededError') {
      return {
        ok: false,
        reason: 'quota',
        message: 'Storage quota exceeded; usage was not saved.',
      };
    }
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// Corrupt JSON or an unexpected schemaVersion is treated as absent, never thrown -
// this is the seam a future migrate() would hook into.
function load<T>(key: string, storage: Storage): T | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveUsage(usage: NmiData, storage: Storage = defaultStorage()): SaveResult {
  return save(`${USAGE_PREFIX}${usage.nmi}`, usage, storage);
}

export function loadUsage(nmi: string, storage: Storage = defaultStorage()): NmiData | null {
  return load<NmiData>(`${USAGE_PREFIX}${nmi}`, storage);
}

export function saveMapping(
  mapping: RegisterMapping,
  storage: Storage = defaultStorage(),
): SaveResult {
  return save(`${MAPPING_PREFIX}${mapping.nmi}`, mapping, storage);
}

export function loadMapping(
  nmi: string,
  storage: Storage = defaultStorage(),
): RegisterMapping | null {
  return load<RegisterMapping>(`${MAPPING_PREFIX}${nmi}`, storage);
}

export function listStoredNmis(storage: Storage = defaultStorage()): string[] {
  const nmis = new Set<string>();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(USAGE_PREFIX)) nmis.add(key.slice(USAGE_PREFIX.length));
  }
  return [...nmis];
}

export function savePlans(plans: Plan[], storage: Storage = defaultStorage()): SaveResult {
  return save(PLANS_KEY, plans, storage);
}

// Absent, corrupt, or version-bumped storage resolves to [] (not null) — a plan library is
// naturally a possibly-empty collection, so callers can iterate without a null check. Entries
// that don't pass isValidPlan (e.g. hand-edited localStorage with a non-numeric rate) are
// dropped rather than risking a NaN bill.
export function loadPlans(storage: Storage = defaultStorage()): Plan[] {
  const plans = load<Plan[]>(PLANS_KEY, storage) ?? [];
  return Array.isArray(plans) ? plans.filter(isValidPlan) : [];
}

export function clearAllUsage(
  opts: { includeMapping?: boolean } = {},
  storage: Storage = defaultStorage(),
): void {
  const includeMapping = opts.includeMapping ?? true;
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (key.startsWith(USAGE_PREFIX) || (includeMapping && key.startsWith(MAPPING_PREFIX))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) storage.removeItem(key);
}
