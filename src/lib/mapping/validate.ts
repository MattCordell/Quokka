import type { Register } from '../nem12';
import type { RegisterMapping, UsageCategory } from './types';

export interface MappingIssue {
  type: 'interval-length' | 'uom';
  category: UsageCategory;
  registerIds: string[];
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: MappingIssue[];
}

// The parser already converts Wh/MWh to kWh and rejects any non-energy UOM (ADR-0012), so
// every register reaching here is already kWh-normalized. This check is a defensive
// assertion for ADR-0011's "must share compatible UOM" requirement, not a live failure mode.
function normalizedUom(uom: string): string {
  const u = uom.trim().toLowerCase();
  if (u === 'kwh' || u === 'wh' || u === 'mwh') return 'kWh';
  return uom;
}

export function validateMapping(registers: Register[], mapping: RegisterMapping): ValidationResult {
  const byCategory = new Map<UsageCategory, Register[]>();
  for (const register of registers) {
    const category = mapping.registers[register.registerId];
    if (!category || category === 'Ignore') continue;
    const group = byCategory.get(category) ?? [];
    group.push(register);
    byCategory.set(category, group);
  }

  const issues: MappingIssue[] = [];
  for (const [category, group] of byCategory) {
    if (group.length < 2) continue;

    const intervalLengths = new Set(group.map((r) => r.intervalLength));
    if (intervalLengths.size > 1) {
      issues.push({
        type: 'interval-length',
        category,
        registerIds: group.map((r) => r.registerId),
        message: `Registers mapped to ${category} have mismatched interval lengths (${[...intervalLengths].join(', ')} min): ${group.map((r) => r.registerId).join(', ')}.`,
      });
    }

    const uoms = new Set(group.map((r) => normalizedUom(r.uom)));
    if (uoms.size > 1) {
      issues.push({
        type: 'uom',
        category,
        registerIds: group.map((r) => r.registerId),
        message: `Registers mapped to ${category} have mismatched UOMs (${[...uoms].join(', ')}): ${group.map((r) => r.registerId).join(', ')}.`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
