import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Discount, FlatPlan, Plan, TouBand, TouPlan } from './types';
import {
  applyPlanImport,
  copyPlan,
  exportPlans,
  parsePlanImport,
  planExportFilename,
  type ImportChoice,
} from './transfer';

function readFixture(relativePath: string): string {
  return readFileSync(new URL(`../../../fixtures/${relativePath}`, import.meta.url), 'utf-8');
}

function validDiscount(): Discount {
  return {
    id: 'disc-a',
    label: 'Direct debit',
    kind: 'guaranteed',
    percent: 10,
    components: ['usage', 'supply'],
  };
}

function validFlatPlan(): FlatPlan {
  return {
    id: 'plan-flat',
    name: 'Test Flat Plan',
    retailer: 'Test Co',
    type: 'flat_rate',
    supply: { generalCentsPerDay: 100, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    usage: { generalRateCentsPerKwh: 30 },
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 5,
    discounts: [validDiscount()],
  };
}

function band(overrides: Partial<TouBand> = {}): TouBand {
  return {
    label: 'All week',
    startTime: '00:00',
    endTime: '24:00',
    rateCentsPerKwh: 25,
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    ...overrides,
  };
}

function validTouPlan(): TouPlan {
  return {
    id: 'plan-tou',
    name: 'Test TOU Plan',
    retailer: 'Test Co',
    type: 'time_of_use',
    supply: { generalCentsPerDay: 110, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    touBands: [band()],
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
  };
}

describe('exportPlans / planExportFilename', () => {
  it('produces a versioned envelope, pretty-printed', () => {
    const text = exportPlans([validFlatPlan()], '2026-07-29T00:00:00.000Z');
    const parsed = JSON.parse(text);
    expect(parsed.kind).toBe('quokka-plan-library');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe('2026-07-29T00:00:00.000Z');
    expect(parsed.plans).toEqual([validFlatPlan()]);
    expect(text).toContain('\n  '); // 2-space indent
  });

  it('names a multi-plan file quokka-plans-<date>.json', () => {
    expect(planExportFilename([validFlatPlan(), validTouPlan()], '2026-07-29T00:00:00.000Z')).toBe(
      'quokka-plans-2026-07-29.json',
    );
  });

  it('names a single-plan file quokka-plan-<slug>-<date>.json', () => {
    expect(planExportFilename([validFlatPlan()], '2026-07-29T00:00:00.000Z')).toBe(
      'quokka-plan-test-flat-plan-2026-07-29.json',
    );
  });
});

describe('parsePlanImport: round-trip fidelity', () => {
  it('reproduces flat, TOU, and discounted plans exactly via export -> import -> apply', () => {
    const discounted: FlatPlan = {
      ...validFlatPlan(),
      id: 'plan-discounted',
      discounts: [validDiscount()],
    };
    const plans: Plan[] = [validFlatPlan(), validTouPlan(), discounted];

    const result = parsePlanImport(exportPlans(plans), []);
    expect(result.ok).toBe(true);
    expect(result.candidates.filter((c) => c.importable)).toHaveLength(3);

    const applied = applyPlanImport([], result.candidates, {}, 'merge');
    expect(applied).toEqual(plans);
  });
});

describe('parsePlanImport: accepted shapes', () => {
  it('accepts an envelope', () => {
    const result = parsePlanImport(exportPlans([validFlatPlan()]), []);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].importable).toBe(true);
  });

  it('accepts a bare array', () => {
    const result = parsePlanImport(JSON.stringify([validFlatPlan(), validTouPlan()]), []);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.importable)).toBe(true);
  });

  it('accepts a bare single plan object, matching the fixtures', () => {
    const result = parsePlanImport(readFixture('plans/tou-plan.json'), []);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].importable).toBe(true);
  });
});

describe('parsePlanImport: fatal file problems', () => {
  it('reports not-json on garbage text', () => {
    const result = parsePlanImport('not { json', []);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('not-json');
  });

  it.each([['{"foo":1}'], ['null'], ['42']])('reports unrecognised-shape on %s', (text) => {
    const result = parsePlanImport(text, []);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('unrecognised-shape');
    expect(result.issues[0].message.length).toBeGreaterThan(0);
  });

  it('rejects an envelope-shaped file with the wrong "kind"', () => {
    const file = JSON.parse(exportPlans([validFlatPlan()]));
    file.kind = 'something-else';
    const result = parsePlanImport(JSON.stringify(file), []);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('unrecognised-shape');
    expect(result.issues[0].message).toContain('kind');
    expect(result.candidates).toHaveLength(0);
  });

  it('rejects an envelope-shaped file with an unsupported schemaVersion', () => {
    const file = JSON.parse(exportPlans([validFlatPlan()]));
    file.schemaVersion = 999;
    const result = parsePlanImport(JSON.stringify(file), []);
    expect(result.ok).toBe(false);
    expect(result.issues[0].type).toBe('unrecognised-shape');
    expect(result.issues[0].message).toContain('schema version');
    expect(result.candidates).toHaveLength(0);
  });
});

describe('parsePlanImport: shape validation', () => {
  it('names the failing field path and marks the candidate non-importable', () => {
    const broken = { ...validFlatPlan(), usage: { generalRateCentsPerKwh: 'oops' } };
    const result = parsePlanImport(JSON.stringify([broken]), []);
    expect(result.candidates[0].importable).toBe(false);
    expect(
      result.candidates[0].issues.some(
        (i) => i.type === 'plan-shape' && i.message.includes('usage.generalRateCentsPerKwh'),
      ),
    ).toBe(true);
  });
});

describe('parsePlanImport: inclusive-end normalisation (ADR-0001)', () => {
  it('normalises an inclusive 23:59 end to exclusive 24:00, and coverage then passes', () => {
    const plan: TouPlan = { ...validTouPlan(), touBands: [band({ endTime: '23:59' })] };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    const candidate = result.candidates[0];
    expect(candidate.plan.type).toBe('time_of_use');
    expect((candidate.plan as TouPlan).touBands[0].endTime).toBe('24:00');
    expect(
      candidate.issues.some(
        (i) =>
          i.type === 'inclusive-end-normalised' &&
          i.message.includes('23:59') &&
          i.message.includes('24:00'),
      ),
    ).toBe(true);
    expect(candidate.importable).toBe(true);
  });

  it('normalises the ADR-0001 example: inclusive 20:59 end to exclusive 21:00', () => {
    const plan: TouPlan = {
      ...validTouPlan(),
      touBands: [band({ label: 'Peak', startTime: '00:00', endTime: '20:59' })],
    };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    expect((result.candidates[0].plan as TouPlan).touBands[0].endTime).toBe('21:00');
  });

  it('leaves an already-exclusive 21:00 end untouched (regression guard)', () => {
    const plan: TouPlan = {
      ...validTouPlan(),
      touBands: [
        band({ label: 'Peak', startTime: '00:00', endTime: '21:00' }),
        band({ label: 'Off-peak', startTime: '21:00', endTime: '24:00' }),
      ],
    };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    const candidate = result.candidates[0];
    const bands = (candidate.plan as TouPlan).touBands;
    expect(bands.find((b) => b.label === 'Peak')?.endTime).toBe('21:00');
    expect(candidate.issues.some((i) => i.type === 'inclusive-end-normalised')).toBe(false);
    expect(candidate.importable).toBe(true);
  });

  it('does not normalise a genuinely misaligned 20:45 end; lands as band-coverage misalignment', () => {
    const plan: TouPlan = {
      ...validTouPlan(),
      touBands: [band({ label: 'Odd band', endTime: '20:45' })],
    };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    const candidate = result.candidates[0];
    expect((candidate.plan as TouPlan).touBands[0].endTime).toBe('20:45');
    expect(candidate.importable).toBe(false);
    expect(
      candidate.issues.some(
        (i) => i.type === 'band-coverage' && i.message.includes('Misaligned boundary: Odd band'),
      ),
    ).toBe(true);
  });
});

describe('parsePlanImport: band coverage', () => {
  it('rejects a gap, naming the day and range', () => {
    const plan: TouPlan = {
      ...validTouPlan(),
      touBands: [band({ startTime: '00:00', endTime: '12:00', days: ['MON'] })],
    };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    const candidate = result.candidates[0];
    expect(candidate.importable).toBe(false);
    expect(
      candidate.issues.some((i) => i.type === 'band-coverage' && i.message.startsWith('Gap: MON')),
    ).toBe(true);
  });

  it('rejects an overlap, naming the day and range', () => {
    const plan: TouPlan = {
      ...validTouPlan(),
      touBands: [band({ label: 'A' }), band({ label: 'B' })],
    };
    const result = parsePlanImport(JSON.stringify([plan]), []);
    const candidate = result.candidates[0];
    expect(candidate.importable).toBe(false);
    expect(
      candidate.issues.some((i) => i.type === 'band-coverage' && i.message.startsWith('Overlap:')),
    ).toBe(true);
  });
});

describe('parsePlanImport: unknown fields', () => {
  it("reports the fixtures' _note as unknown-field and strips it from the imported plan", () => {
    const result = parsePlanImport(readFixture('plans/flat-plan.json'), []);
    const candidate = result.candidates[0];
    expect(candidate.importable).toBe(true);
    expect(
      candidate.issues.some((i) => i.type === 'unknown-field' && i.message.includes('_note')),
    ).toBe(true);
    expect('_note' in candidate.plan).toBe(false);
  });

  it('reports a stray touBands on a flat_rate plan as unknown-field rather than silently dropping it', () => {
    const strayed = { ...validFlatPlan(), touBands: [band()] };
    const result = parsePlanImport(JSON.stringify([strayed]), []);
    const candidate = result.candidates[0];
    expect(candidate.importable).toBe(true);
    expect(
      candidate.issues.some((i) => i.type === 'unknown-field' && i.message.includes('touBands')),
    ).toBe(true);
    expect('touBands' in candidate.plan).toBe(false);
  });

  it('reports a stray usage on a time_of_use plan as unknown-field rather than silently dropping it', () => {
    const strayed = { ...validTouPlan(), usage: { generalRateCentsPerKwh: 30 } };
    const result = parsePlanImport(JSON.stringify([strayed]), []);
    const candidate = result.candidates[0];
    expect(candidate.importable).toBe(true);
    expect(
      candidate.issues.some((i) => i.type === 'unknown-field' && i.message.includes('usage')),
    ).toBe(true);
    expect('usage' in candidate.plan).toBe(false);
  });
});

describe('parsePlanImport + applyPlanImport: collisions', () => {
  const existingPlan: Plan = {
    ...validFlatPlan(),
    id: 'existing-id',
    name: 'Existing Plan',
    retailer: 'Existing Co',
  };

  it('detects an id collision', () => {
    const incoming = { ...validFlatPlan(), id: 'existing-id', name: 'Renamed' };
    const result = parsePlanImport(JSON.stringify([incoming]), [existingPlan]);
    expect(result.candidates[0].collision).toEqual({
      kind: 'id',
      existingPlanId: 'existing-id',
      existingLabel: 'Existing Plan (Existing Co)',
    });
  });

  it('detects a name+retailer collision (trimmed, case-insensitive)', () => {
    const incoming = {
      ...validFlatPlan(),
      id: 'a-new-id',
      name: ' existing plan ',
      retailer: 'existing co',
    };
    const result = parsePlanImport(JSON.stringify([incoming]), [existingPlan]);
    expect(result.candidates[0].collision?.kind).toBe('name');
    expect(result.candidates[0].collision?.existingPlanId).toBe('existing-id');
  });

  function collidingResult() {
    const incoming = { ...validFlatPlan(), id: 'existing-id', name: 'Renamed', retailer: 'New Co' };
    return parsePlanImport(JSON.stringify([incoming]), [existingPlan]);
  }

  it('skip leaves the existing library untouched', () => {
    const result = collidingResult();
    const choices: Record<number, ImportChoice> = { 0: 'skip' };
    expect(applyPlanImport([existingPlan], result.candidates, choices, 'merge')).toEqual([
      existingPlan,
    ]);
  });

  it('keep-both mints a fresh id and an "(imported)" suffix, leaving the existing plan untouched', () => {
    const result = collidingResult();
    const choices: Record<number, ImportChoice> = { 0: 'keep-both' };
    const applied = applyPlanImport([existingPlan], result.candidates, choices, 'merge');
    expect(applied).toHaveLength(2);
    expect(applied[0]).toEqual(existingPlan);
    expect(applied[1].name).toBe('Renamed (imported)');
    expect(applied[1].id).not.toBe(existingPlan.id);
  });

  it('overwrite replaces the colliding entry in its existing list position', () => {
    const other: Plan = { ...validFlatPlan(), id: 'other-id', name: 'Other Plan' };
    const result = collidingResult();
    const choices: Record<number, ImportChoice> = { 0: 'overwrite' };
    const applied = applyPlanImport([existingPlan, other], result.candidates, choices, 'merge');
    expect(applied).toHaveLength(2);
    expect(applied[0].id).toBe('existing-id'); // position + id preserved
    expect(applied[0].name).toBe('Renamed'); // content replaced
    expect(applied[1]).toEqual(other);
  });

  it('overwrite falls back to appending if the collision target was deleted before apply', () => {
    // The collision snapshot is captured at parsePlanImport time; simulate the target plan
    // having been deleted from the library before the user confirms the import.
    const result = collidingResult();
    const choices: Record<number, ImportChoice> = { 0: 'overwrite' };
    const applied = applyPlanImport([], result.candidates, choices, 'merge');
    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe('Renamed');
  });
});

describe('applyPlanImport: replace mode', () => {
  it('wipes the existing library and restores only the imported plans', () => {
    const existingA: Plan = { ...validFlatPlan(), id: 'a' };
    const existingB: Plan = { ...validFlatPlan(), id: 'b', name: 'B' };
    const incomingC = { ...validFlatPlan(), id: 'c', name: 'C' };
    const incomingD = { ...validFlatPlan(), id: 'd', name: 'D' };

    const result = parsePlanImport(JSON.stringify([incomingC, incomingD]), [existingA, existingB]);
    const applied = applyPlanImport([existingA, existingB], result.candidates, {}, 'replace');

    expect(applied.map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('dedupes in-file duplicate ids', () => {
    const dupe = { ...validFlatPlan(), id: 'dupe', name: 'First' };
    const dupeAgain = { ...validFlatPlan(), id: 'dupe', name: 'Second' };

    const result = parsePlanImport(JSON.stringify([dupe, dupeAgain]), []);
    expect(result.candidates[1].issues.some((i) => i.type === 'duplicate-id-in-file')).toBe(true);

    const applied = applyPlanImport([], result.candidates, {}, 'replace');
    expect(applied).toHaveLength(2);
    expect(new Set(applied.map((p) => p.id)).size).toBe(2);
  });

  it('ignores a stale per-candidate "skip" choice — every importable candidate is restored', () => {
    // Regression: replace mode used to honour choices[sourceIndex] === 'skip', so a choice left
    // over from merge mode (or set against the UI's intent, since replace hides the per-row
    // radios) could wipe the library and import nothing.
    const existingA: Plan = { ...validFlatPlan(), id: 'a' };
    const incomingA = { ...validFlatPlan(), id: 'a', name: 'Renamed A' };

    const result = parsePlanImport(JSON.stringify([incomingA]), [existingA]);
    const choices: Record<number, ImportChoice> = { 0: 'skip' };
    const applied = applyPlanImport([existingA], result.candidates, choices, 'replace');

    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe('Renamed A');
  });
});

describe('copyPlan', () => {
  it('deep-copies days and components independently of the source', () => {
    const source: TouPlan = { ...validTouPlan(), touBands: [band({ days: ['MON'] })] };
    const copy = copyPlan(source, { name: 'Copy' }) as TouPlan;
    copy.touBands[0].days.push('SAT');
    expect(source.touBands[0].days).toEqual(['MON']);

    const flat = { ...validFlatPlan(), discounts: [validDiscount()] };
    const flatCopy = copyPlan(flat);
    flatCopy.discounts[0].components.push('supply');
    expect(flat.discounts[0].components).toEqual(['usage', 'supply']);
  });

  it('mints a fresh plan id and fresh discount ids', () => {
    const source = { ...validFlatPlan(), discounts: [validDiscount()] };
    const copy = copyPlan(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.discounts[0].id).not.toBe(source.discounts[0].id);
  });
});
