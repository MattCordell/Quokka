import type { Register } from '../nem12';
import type { RegisterMapping, UsageCategory } from './types';

export interface MappingIssue {
  type: 'interval-length';
  category: UsageCategory;
  registerIds: string[];
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: MappingIssue[];
}

// UOM isn't checked here: the parser already converts Wh/MWh to kWh and rejects any
// non-energy UOM (ADR-0012), so every register reaching this function is already
// kWh-normalized and a same-category UOM mismatch can't occur.
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
  }

  return { ok: issues.length === 0, issues };
}
