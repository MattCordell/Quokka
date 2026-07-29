/**
 * The Plan schema, codified from fixtures/plans/{flat-plan,tou-plan}.json. All rates are
 * integer cents, GST-inclusive (PRD 7.4) — there is no separate GST field anywhere.
 */
export const DISCOUNT_KINDS = ['guaranteed', 'conditional'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const DISCOUNT_COMPONENTS = ['usage', 'supply'] as const;
/** 'usage' = General + CL1 + CL2 usage; 'supply' = the daily supply charge.
 *  The Solar Credit is never discountable (ADR-0007) and is deliberately not representable. */
export type DiscountComponent = (typeof DISCOUNT_COMPONENTS)[number];
export const DEFAULT_DISCOUNT_COMPONENTS: readonly DiscountComponent[] = ['usage', 'supply'];

/** ADR-0007: a guaranteed discount always applies; a conditional one only in the best-case total. */
export interface Discount {
  id: string; // crypto.randomUUID(), for {#each} keying + joining Bill lines back
  label: string; // "Pay on time"; may be empty, UI falls back to a kind-derived label
  kind: DiscountKind;
  percent: number; // 0-100 inclusive
  components: DiscountComponent[]; // non-empty
}

export interface SupplyCharges {
  generalCentsPerDay: number;
  cl1CentsPerDay: number;
  cl2CentsPerDay: number;
}

export interface ControlledLoadRates {
  cl1RateCentsPerKwh: number;
  cl2RateCentsPerKwh: number;
}

interface PlanBase {
  id: string;
  name: string;
  retailer: string;
  supply: SupplyCharges;
  controlledLoad: ControlledLoadRates;
  feedInRateCentsPerKwh: number;
  discounts: Discount[];
}

export interface FlatPlan extends PlanBase {
  type: 'flat_rate';
  usage: { generalRateCentsPerKwh: number };
}

export const TOU_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type TouDay = (typeof TOU_DAYS)[number];

export interface TouBand {
  label: string;
  startTime: string; // "HH:MM", half-open [start,end) per ADR-0001
  endTime: string; // "HH:MM"; "24:00" is the end-of-day exclusive sentinel; may wrap midnight
  rateCentsPerKwh: number;
  days: TouDay[];
}

export interface TouPlan extends PlanBase {
  type: 'time_of_use';
  touBands: TouBand[];
}

export type Plan = FlatPlan | TouPlan;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface PlanShapeIssue {
  field: string;
  message: string;
}

export interface PlanShapeResult {
  ok: boolean;
  issues: PlanShapeIssue[];
}

function discountShapeIssues(value: unknown, field: string): PlanShapeIssue[] {
  if (!isRecord(value)) return [{ field, message: `${field} must be an object` }];
  const issues: PlanShapeIssue[] = [];
  if (typeof value.id !== 'string' || value.id === '') {
    issues.push({ field: `${field}.id`, message: `${field}.id must be a non-empty string` });
  }
  if (typeof value.label !== 'string') {
    issues.push({ field: `${field}.label`, message: `${field}.label must be a string` });
  }
  if (!(DISCOUNT_KINDS as readonly string[]).includes(value.kind as string)) {
    issues.push({
      field: `${field}.kind`,
      message: `${field}.kind must be one of ${DISCOUNT_KINDS.join(', ')}`,
    });
  }
  if (!isFiniteNumber(value.percent) || value.percent < 0 || value.percent > 100) {
    issues.push({
      field: `${field}.percent`,
      message: `${field}.percent must be a number between 0 and 100`,
    });
  }
  if (!Array.isArray(value.components) || value.components.length === 0) {
    issues.push({
      field: `${field}.components`,
      message: `${field}.components must be a non-empty array`,
    });
  } else if (
    !value.components.every((c) => (DISCOUNT_COMPONENTS as readonly string[]).includes(c))
  ) {
    issues.push({
      field: `${field}.components`,
      message: `${field}.components must only contain ${DISCOUNT_COMPONENTS.join(', ')}`,
    });
  }
  return issues;
}

function touBandShapeIssues(value: unknown, field: string): PlanShapeIssue[] {
  if (!isRecord(value)) return [{ field, message: `${field} must be an object` }];
  const issues: PlanShapeIssue[] = [];
  if (typeof value.label !== 'string') {
    issues.push({ field: `${field}.label`, message: `${field}.label must be a string` });
  }
  if (typeof value.startTime !== 'string' || !TIME_PATTERN.test(value.startTime)) {
    issues.push({
      field: `${field}.startTime`,
      message: `${field}.startTime must be "HH:MM" on 00:00-23:59`,
    });
  }
  if (typeof value.endTime !== 'string' || !END_TIME_PATTERN.test(value.endTime)) {
    issues.push({
      field: `${field}.endTime`,
      message: `${field}.endTime must be "HH:MM" on 00:00-23:59, or "24:00"`,
    });
  }
  if (!isFiniteNumber(value.rateCentsPerKwh)) {
    issues.push({
      field: `${field}.rateCentsPerKwh`,
      message: `${field}.rateCentsPerKwh must be a finite number`,
    });
  }
  if (!Array.isArray(value.days) || value.days.length === 0) {
    issues.push({ field: `${field}.days`, message: `${field}.days must be a non-empty array` });
  } else if (!value.days.every((day) => (TOU_DAYS as readonly string[]).includes(day))) {
    issues.push({
      field: `${field}.days`,
      message: `${field}.days must only contain ${TOU_DAYS.join(', ')}`,
    });
  }
  return issues;
}

/**
 * A minimal shape check for a value loaded from storage, with field-path messages for import
 * review (issue #10). `load()` only gates on schemaVersion (persistence.ts), not field shapes,
 * and a Plan is the one persisted collection that flows straight into arithmetic
 * (computeFlatBill) — a malformed rate (non-numeric, or hand-edited localStorage) would
 * otherwise surface as a silent "$NaN" bill instead of being caught here.
 */
export function validatePlanShape(value: unknown): PlanShapeResult {
  const issues: PlanShapeIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ field: '(root)', message: 'plan must be an object' }] };
  }

  if (typeof value.id !== 'string') issues.push({ field: 'id', message: 'id must be a string' });
  if (typeof value.name !== 'string') {
    issues.push({ field: 'name', message: 'name must be a string' });
  }
  if (typeof value.retailer !== 'string') {
    issues.push({ field: 'retailer', message: 'retailer must be a string' });
  }

  if (!Array.isArray(value.discounts)) {
    issues.push({ field: 'discounts', message: 'discounts must be an array' });
  } else {
    value.discounts.forEach((d, i) => issues.push(...discountShapeIssues(d, `discounts[${i}]`)));
  }

  const supply = value.supply;
  if (!isRecord(supply)) {
    issues.push({ field: 'supply', message: 'supply must be an object' });
  } else {
    if (!isFiniteNumber(supply.generalCentsPerDay)) {
      issues.push({
        field: 'supply.generalCentsPerDay',
        message: 'supply.generalCentsPerDay must be a finite number',
      });
    }
    if (!isFiniteNumber(supply.cl1CentsPerDay)) {
      issues.push({
        field: 'supply.cl1CentsPerDay',
        message: 'supply.cl1CentsPerDay must be a finite number',
      });
    }
    if (!isFiniteNumber(supply.cl2CentsPerDay)) {
      issues.push({
        field: 'supply.cl2CentsPerDay',
        message: 'supply.cl2CentsPerDay must be a finite number',
      });
    }
  }

  const controlledLoad = value.controlledLoad;
  if (!isRecord(controlledLoad)) {
    issues.push({ field: 'controlledLoad', message: 'controlledLoad must be an object' });
  } else {
    if (!isFiniteNumber(controlledLoad.cl1RateCentsPerKwh)) {
      issues.push({
        field: 'controlledLoad.cl1RateCentsPerKwh',
        message: 'controlledLoad.cl1RateCentsPerKwh must be a finite number',
      });
    }
    if (!isFiniteNumber(controlledLoad.cl2RateCentsPerKwh)) {
      issues.push({
        field: 'controlledLoad.cl2RateCentsPerKwh',
        message: 'controlledLoad.cl2RateCentsPerKwh must be a finite number',
      });
    }
  }

  if (!isFiniteNumber(value.feedInRateCentsPerKwh)) {
    issues.push({
      field: 'feedInRateCentsPerKwh',
      message: 'feedInRateCentsPerKwh must be a finite number',
    });
  }

  if (value.type === 'flat_rate') {
    const usage = value.usage;
    if (!isRecord(usage) || !isFiniteNumber(usage.generalRateCentsPerKwh)) {
      issues.push({
        field: 'usage.generalRateCentsPerKwh',
        message: 'usage.generalRateCentsPerKwh must be a finite number',
      });
    }
  } else if (value.type === 'time_of_use') {
    if (!Array.isArray(value.touBands) || value.touBands.length === 0) {
      issues.push({ field: 'touBands', message: 'touBands must be a non-empty array' });
    } else {
      value.touBands.forEach((b, i) => issues.push(...touBandShapeIssues(b, `touBands[${i}]`)));
    }
  } else {
    issues.push({
      field: 'type',
      message: `type must be one of flat_rate, time_of_use (got ${JSON.stringify(value.type)})`,
    });
  }

  return { ok: issues.length === 0, issues };
}

export function isValidPlan(value: unknown): value is Plan {
  return validatePlanShape(value).ok;
}

// "HH:MM" on 00:00-23:59. startTime never accepts the "24:00" sentinel — that value only
// means "end of day" (ADR-0001), and end-only exempts a start='00:00' band from ever legally
// starting at the same instant it ends.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// endTime additionally accepts "24:00", the end-of-day exclusive sentinel (ADR-0001).
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/**
 * Exported so the plan editor can validate one discount row without building a whole plan.
 * Deliberately does not reject duplicate components (parity with TouBand.days; the pricer uses
 * `.includes()`) or duplicate ids across a plan's discount list.
 */
export function isValidDiscount(value: unknown): value is Discount {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id === '') return false;
  if (typeof value.label !== 'string') return false;
  if (!(DISCOUNT_KINDS as readonly string[]).includes(value.kind as string)) return false;
  if (!isFiniteNumber(value.percent) || value.percent < 0 || value.percent > 100) return false;
  if (!Array.isArray(value.components) || value.components.length === 0) return false;
  return value.components.every((c) => (DISCOUNT_COMPONENTS as readonly string[]).includes(c));
}
