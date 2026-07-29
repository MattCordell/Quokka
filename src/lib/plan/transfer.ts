/**
 * Plan library import/export (issue #10). Framework-agnostic, no Svelte/DOM imports
 * (ADR-0013). House validator style ([mapping/validate.ts](../mapping/validate.ts)):
 * collect-and-return, never throw; every issue carries a machine-readable `type`, the
 * offending domain data, and a pre-formatted human `message`. Only the parser and calc
 * engine throw.
 */
import {
  DEFAULT_DISCOUNT_COMPONENTS,
  DISCOUNT_COMPONENTS,
  DISCOUNT_KINDS,
  TOU_DAYS,
  validatePlanShape,
  type Discount,
  type DiscountComponent,
  type DiscountKind,
  type Plan,
  type TouBand,
  type TouDay,
} from './types';
import { analyzeCoverage, normalizeInclusiveEnd, parseTime } from './coverage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numOf(container: unknown, key: string, fallback = 0): number {
  if (!isRecord(container)) return fallback;
  const value = container[key];
  return isFiniteNumber(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const PLAN_EXPORT_KIND = 'quokka-plan-library';
export const PLAN_EXPORT_VERSION = 1;

export interface PlanExportFile {
  kind: typeof PLAN_EXPORT_KIND;
  schemaVersion: number; // tracks the Plan shape
  exportedAt: string; // ISO 8601
  plans: Plan[];
}

/**
 * Deliberately its own version constant, not persistence's SCHEMA_VERSION — coupling them
 * would invalidate every exported backup file when the storage envelope bumps for an
 * unrelated usage-shape change.
 */
export function exportPlans(plans: Plan[], exportedAt: string = new Date().toISOString()): string {
  const file: PlanExportFile = {
    kind: PLAN_EXPORT_KIND,
    schemaVersion: PLAN_EXPORT_VERSION,
    exportedAt,
    plans,
  };
  return JSON.stringify(file, null, 2);
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'plan';
}

export function planExportFilename(
  plans: Plan[],
  exportedAt: string = new Date().toISOString(),
): string {
  const date = exportedAt.slice(0, 10);
  if (plans.length === 1) {
    return `quokka-plan-${slugify(plans[0].name)}-${date}.json`;
  }
  return `quokka-plans-${date}.json`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type PlanImportIssueType =
  | 'not-json'
  | 'unrecognised-shape'
  | 'plan-shape'
  | 'band-coverage'
  | 'unknown-field'
  | 'inclusive-end-normalised'
  | 'duplicate-id-in-file';

export interface PlanImportIssue {
  type: PlanImportIssueType;
  planIndex: number | null; // index in the source file; null = file-level
  message: string;
}

export type CollisionKind = 'id' | 'name';

export interface PlanImportCandidate {
  plan: Plan; // normalised, deep-copied, unknown keys stripped
  sourceIndex: number;
  importable: boolean; // false = shape- or coverage-invalid; can never be saved
  issues: PlanImportIssue[];
  collision: { kind: CollisionKind; existingPlanId: string; existingLabel: string } | null;
}

export interface PlanImportResult {
  ok: boolean; // false on a fatal file problem or zero importable candidates
  issues: PlanImportIssue[]; // file-level
  candidates: PlanImportCandidate[];
}

const PLAN_TOP_KEYS = [
  'id',
  'name',
  'retailer',
  'supply',
  'controlledLoad',
  'feedInRateCentsPerKwh',
  'discounts',
  'type',
  'usage',
  'touBands',
] as const;
const SUPPLY_KEYS = ['generalCentsPerDay', 'cl1CentsPerDay', 'cl2CentsPerDay'] as const;
const CONTROLLED_LOAD_KEYS = ['cl1RateCentsPerKwh', 'cl2RateCentsPerKwh'] as const;
const USAGE_KEYS = ['generalRateCentsPerKwh'] as const;
const TOU_BAND_KEYS = ['label', 'startTime', 'endTime', 'rateCentsPerKwh', 'days'] as const;
const DISCOUNT_KEYS = ['id', 'label', 'kind', 'percent', 'components'] as const;

function looksLikePlanRecord(value: Record<string, unknown>): boolean {
  return PLAN_TOP_KEYS.some((key) => key in value);
}

type SourcePlansResult = { plans: unknown[] } | { errorMessage: string };

function describeUnrecognisedShape(parsed: unknown): string {
  const seen =
    parsed === null
      ? 'null'
      : typeof parsed === 'object'
        ? 'an object with no recognised plan fields'
        : `a ${typeof parsed}`;
  return `Expected a plan object, an array of plans, or a Quokka plan-library export — got ${seen}.`;
}

/**
 * Validates the envelope's own `kind`/`schemaVersion` rather than accepting any object with a
 * `plans` array — otherwise `PLAN_EXPORT_VERSION` is write-only and the forward-migration hook
 * ADR-0017 justifies the envelope with doesn't actually exist.
 */
function resolveSourcePlans(parsed: unknown): SourcePlansResult {
  if (isRecord(parsed) && Array.isArray(parsed.plans)) {
    if (parsed.kind !== PLAN_EXPORT_KIND) {
      return {
        errorMessage: `This file's "kind" (${JSON.stringify(parsed.kind)}) doesn't match a Quokka plan-library export (expected "${PLAN_EXPORT_KIND}").`,
      };
    }
    if (parsed.schemaVersion !== PLAN_EXPORT_VERSION) {
      return {
        errorMessage: `This file's schema version (${JSON.stringify(parsed.schemaVersion)}) isn't supported by this build (expected ${PLAN_EXPORT_VERSION}).`,
      };
    }
    return { plans: parsed.plans };
  }
  if (Array.isArray(parsed)) return { plans: parsed };
  if (isRecord(parsed) && looksLikePlanRecord(parsed)) return { plans: [parsed] };
  return { errorMessage: describeUnrecognisedShape(parsed) };
}

function collectUnknownFieldIssues(
  record: Record<string, unknown>,
  sourceIndex: number,
): PlanImportIssue[] {
  const issues: PlanImportIssue[] = [];
  const note = (path: string): void => {
    issues.push({
      type: 'unknown-field',
      planIndex: sourceIndex,
      message: `Unknown field "${path}" was stripped from the imported plan.`,
    });
  };

  for (const key of Object.keys(record)) {
    if (!(PLAN_TOP_KEYS as readonly string[]).includes(key)) note(key);
  }

  const nested: Array<[unknown, readonly string[], string]> = [
    [record.supply, SUPPLY_KEYS, 'supply'],
    [record.controlledLoad, CONTROLLED_LOAD_KEYS, 'controlledLoad'],
    [record.usage, USAGE_KEYS, 'usage'],
  ];
  for (const [value, allowed, prefix] of nested) {
    if (!isRecord(value)) continue;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) note(`${prefix}.${key}`);
    }
  }

  if (Array.isArray(record.touBands)) {
    record.touBands.forEach((band, i) => {
      if (!isRecord(band)) return;
      for (const key of Object.keys(band)) {
        if (!(TOU_BAND_KEYS as readonly string[]).includes(key)) note(`touBands[${i}].${key}`);
      }
    });
  }
  if (Array.isArray(record.discounts)) {
    record.discounts.forEach((d, i) => {
      if (!isRecord(d)) return;
      for (const key of Object.keys(d)) {
        if (!(DISCOUNT_KEYS as readonly string[]).includes(key)) note(`discounts[${i}].${key}`);
      }
    });
  }

  // A cross-type field (touBands on a flat plan, usage on a TOU plan) is otherwise silently
  // dropped by projectPlan with no trace — that contradicts "nothing is silently dropped"
  // (ADR-0017), so it gets the same unknown-field treatment as any other stray key.
  if (record.type === 'flat_rate' && 'touBands' in record) note('touBands');
  if (record.type === 'time_of_use' && 'usage' in record) note('usage');

  return issues;
}

function projectDiscount(raw: unknown): Discount {
  const r = isRecord(raw) ? raw : {};
  const kind: DiscountKind = (DISCOUNT_KINDS as readonly string[]).includes(r.kind as string)
    ? (r.kind as DiscountKind)
    : 'conditional';
  const components: DiscountComponent[] =
    Array.isArray(r.components) &&
    r.components.length > 0 &&
    r.components.every((c) => (DISCOUNT_COMPONENTS as readonly string[]).includes(c as string))
      ? [...(r.components as DiscountComponent[])]
      : [...DEFAULT_DISCOUNT_COMPONENTS];
  const percent = isFiniteNumber(r.percent) && r.percent >= 0 && r.percent <= 100 ? r.percent : 0;
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : crypto.randomUUID(),
    label: typeof r.label === 'string' ? r.label : '',
    kind,
    percent,
    components,
  };
}

function projectTouBand(raw: unknown): TouBand {
  const r = isRecord(raw) ? raw : {};
  const days: TouDay[] =
    Array.isArray(r.days) &&
    r.days.length > 0 &&
    r.days.every((d) => (TOU_DAYS as readonly string[]).includes(d as string))
      ? [...(r.days as TouDay[])]
      : [...TOU_DAYS];
  return {
    label: typeof r.label === 'string' ? r.label : '',
    startTime: typeof r.startTime === 'string' ? r.startTime : '00:00',
    endTime: typeof r.endTime === 'string' ? r.endTime : '24:00',
    rateCentsPerKwh: isFiniteNumber(r.rateCentsPerKwh) ? r.rateCentsPerKwh : 0,
    days,
  };
}

/**
 * Best-effort projection to a clean `Plan`. When the source already passed
 * `validatePlanShape`, this is a pure deep-copy (with `name`/`retailer` trimmed, matching
 * `submitForm`); when it didn't, it defensively fills in defaults so the import review UI
 * always has something displayable for a non-importable row.
 */
function projectPlan(record: Record<string, unknown>): Plan {
  const discounts = Array.isArray(record.discounts) ? record.discounts.map(projectDiscount) : [];
  const common = {
    id: typeof record.id === 'string' && record.id !== '' ? record.id : crypto.randomUUID(),
    name: typeof record.name === 'string' ? record.name.trim() : '',
    retailer: typeof record.retailer === 'string' ? record.retailer.trim() : '',
    supply: {
      generalCentsPerDay: numOf(record.supply, 'generalCentsPerDay'),
      cl1CentsPerDay: numOf(record.supply, 'cl1CentsPerDay'),
      cl2CentsPerDay: numOf(record.supply, 'cl2CentsPerDay'),
    },
    controlledLoad: {
      cl1RateCentsPerKwh: numOf(record.controlledLoad, 'cl1RateCentsPerKwh'),
      cl2RateCentsPerKwh: numOf(record.controlledLoad, 'cl2RateCentsPerKwh'),
    },
    feedInRateCentsPerKwh: numOf(record, 'feedInRateCentsPerKwh'),
    discounts,
  };

  if (record.type === 'time_of_use') {
    const bands =
      Array.isArray(record.touBands) && record.touBands.length > 0
        ? record.touBands.map(projectTouBand)
        : [projectTouBand(undefined)];
    return { ...common, type: 'time_of_use', touBands: bands };
  }
  return {
    ...common,
    type: 'flat_rate',
    usage: { generalRateCentsPerKwh: numOf(record.usage, 'generalRateCentsPerKwh') },
  };
}

function nameKey(name: string, retailer: string): string {
  return `${name.trim().toLowerCase()}::${retailer.trim().toLowerCase()}`;
}

function detectCollision(plan: Plan, existing: Plan[]): PlanImportCandidate['collision'] {
  const byId = existing.find((p) => p.id === plan.id);
  if (byId) {
    return {
      kind: 'id',
      existingPlanId: byId.id,
      existingLabel: `${byId.name} (${byId.retailer})`,
    };
  }
  const key = nameKey(plan.name, plan.retailer);
  const byName = existing.find((p) => nameKey(p.name, p.retailer) === key);
  if (byName) {
    return {
      kind: 'name',
      existingPlanId: byName.id,
      existingLabel: `${byName.name} (${byName.retailer})`,
    };
  }
  return null;
}

function buildCandidate(
  raw: unknown,
  sourceIndex: number,
  existing: Plan[],
  intervalMinutes: number,
  seenIdsInFile: Set<string>,
): PlanImportCandidate {
  const record = isRecord(raw) ? raw : {};
  const issues: PlanImportIssue[] = collectUnknownFieldIssues(record, sourceIndex);

  const shapeResult = validatePlanShape(raw);
  let plan = projectPlan(record);
  let importable = shapeResult.ok;

  if (!shapeResult.ok) {
    for (const issue of shapeResult.issues) {
      issues.push({ type: 'plan-shape', planIndex: sourceIndex, message: issue.message });
    }
  } else if (plan.type === 'time_of_use') {
    const touBands = plan.touBands.map((band, i) => {
      const endMinute = parseTime(band.endTime);
      const isInclusiveEnd =
        (endMinute + 1) % intervalMinutes === 0 && endMinute % intervalMinutes !== 0;
      if (!isInclusiveEnd) return band;
      const normalised = normalizeInclusiveEnd(band.endTime, intervalMinutes);
      issues.push({
        type: 'inclusive-end-normalised',
        planIndex: sourceIndex,
        message: `${band.label || `Band ${i + 1}`}: inclusive end "${band.endTime}" normalised to exclusive "${normalised}".`,
      });
      return { ...band, endTime: normalised };
    });
    plan = { ...plan, touBands };

    const coverage = analyzeCoverage(plan.touBands, intervalMinutes);
    if (!coverage.ok) {
      importable = false;
      for (const label of coverage.misaligned) {
        issues.push({
          type: 'band-coverage',
          planIndex: sourceIndex,
          message: `Misaligned boundary: ${label}`,
        });
      }
      for (const gap of coverage.gaps) {
        issues.push({
          type: 'band-coverage',
          planIndex: sourceIndex,
          message: `Gap: ${gap.day} ${gap.range}`,
        });
      }
      for (const overlap of coverage.overlaps) {
        issues.push({
          type: 'band-coverage',
          planIndex: sourceIndex,
          message: `Overlap: ${overlap.day} ${overlap.range}`,
        });
      }
    }
  }

  if (seenIdsInFile.has(plan.id)) {
    issues.push({
      type: 'duplicate-id-in-file',
      planIndex: sourceIndex,
      message: `Duplicate id "${plan.id}" also appears earlier in this file.`,
    });
  } else {
    seenIdsInFile.add(plan.id);
  }

  return { plan, sourceIndex, importable, issues, collision: detectCollision(plan, existing) };
}

/**
 * Interval length is fixed at 30, not derived from loaded usage: that is the grid the editor
 * validates on, and coverage.ts documents it as safe for 5/15/30-min register data alike. It
 * also keeps this module free of any NMI/usage dependency.
 */
export function parsePlanImport(
  text: string,
  existing: Plan[],
  intervalMinutes = 30,
): PlanImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          type: 'not-json',
          planIndex: null,
          message: `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      candidates: [],
    };
  }

  const resolved = resolveSourcePlans(parsed);
  if ('errorMessage' in resolved) {
    return {
      ok: false,
      issues: [{ type: 'unrecognised-shape', planIndex: null, message: resolved.errorMessage }],
      candidates: [],
    };
  }

  const seenIdsInFile = new Set<string>();
  const candidates = resolved.plans.map((raw, sourceIndex) =>
    buildCandidate(raw, sourceIndex, existing, intervalMinutes, seenIdsInFile),
  );

  return { ok: candidates.some((c) => c.importable), issues: [], candidates };
}

// ---------------------------------------------------------------------------
// Applying the user's choices
// ---------------------------------------------------------------------------

export type ImportChoice = 'skip' | 'keep-both' | 'overwrite';

function defaultNewId(): string {
  return crypto.randomUUID();
}

function dedupeIds(plans: Plan[], newId: () => string): Plan[] {
  const seen = new Set<string>();
  return plans.map((p) => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      return p;
    }
    const freshId = newId();
    seen.add(freshId);
    return { ...p, id: freshId };
  });
}

function nextAvailableImportedName(plan: Plan, pool: Plan[]): string {
  const taken = new Set(pool.map((p) => nameKey(p.name, p.retailer)));
  let attempt = `${plan.name} (imported)`;
  let n = 2;
  while (taken.has(nameKey(attempt, plan.retailer))) {
    attempt = `${plan.name} (imported ${n})`;
    n += 1;
  }
  return attempt;
}

/**
 * `copyPlan` is shared by `keep-both` (below) and the plan editor's Duplicate action so the
 * two can't drift; it mints fresh discount ids too.
 */
export function copyPlan(plan: Plan, opts: { name?: string; newId?: () => string } = {}): Plan {
  const mintId = opts.newId ?? defaultNewId;
  const discounts = plan.discounts.map((d) => ({
    ...d,
    id: mintId(),
    components: [...d.components],
  }));
  const common = {
    id: mintId(),
    name: opts.name ?? plan.name,
    retailer: plan.retailer,
    supply: { ...plan.supply },
    controlledLoad: { ...plan.controlledLoad },
    feedInRateCentsPerKwh: plan.feedInRateCentsPerKwh,
    discounts,
  };
  if (plan.type === 'time_of_use') {
    return {
      ...common,
      type: 'time_of_use',
      touBands: plan.touBands.map((b) => ({ ...b, days: [...b.days] })),
    };
  }
  return { ...common, type: 'flat_rate', usage: { ...plan.usage } };
}

/**
 * `merge`: `skip` omits; `keep-both` mints a fresh plan id and suffixes the name (escalating
 * on a further collision), leaving the existing plan untouched; `overwrite` replaces the
 * colliding entry in its existing list position (keeping the existing id) so the table
 * doesn't reshuffle. Non-colliding importable candidates are simply appended.
 *
 * `replace`: returns every importable candidate; collision choices are moot (ADR-0017) — the
 * whole existing library is gone either way, so there is nothing left to collide with.
 *
 * `importable: false` candidates are never included, whatever the choice. A final pass
 * guarantees id uniqueness across the returned array (catches in-file duplicates).
 */
export function applyPlanImport(
  existing: Plan[],
  candidates: PlanImportCandidate[],
  choices: Record<number, ImportChoice>,
  mode: 'merge' | 'replace',
  newId: () => string = defaultNewId,
): Plan[] {
  const importable = candidates.filter((c) => c.importable);

  if (mode === 'replace') {
    // Collision choices are moot in replace mode (ADR-0017) — every importable candidate is
    // restored regardless of any choice recorded against it (e.g. left over from merge mode).
    return dedupeIds(
      importable.map((c) => c.plan),
      newId,
    );
  }

  let next = [...existing];
  for (const candidate of importable) {
    if (!candidate.collision) {
      next = [...next, candidate.plan];
      continue;
    }
    const choice = choices[candidate.sourceIndex] ?? 'keep-both';
    if (choice === 'skip') continue;
    if (choice === 'overwrite') {
      const existingId = candidate.collision.existingPlanId;
      const targetStillExists = next.some((p) => p.id === existingId);
      // The collision snapshot is stale as of parsePlanImport time; if the target plan was
      // since deleted, fall back to appending rather than silently dropping the import.
      next = targetStillExists
        ? next.map((p) => (p.id === existingId ? { ...candidate.plan, id: existingId } : p))
        : [...next, candidate.plan];
    } else {
      next = [
        ...next,
        copyPlan(candidate.plan, { name: nextAvailableImportedName(candidate.plan, next), newId }),
      ];
    }
  }
  return dedupeIds(next, newId);
}
