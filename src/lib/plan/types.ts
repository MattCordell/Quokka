/**
 * The Plan schema, codified from fixtures/plans/{flat-plan,tou-plan}.json. All rates are
 * integer cents, GST-inclusive (PRD 7.4) — there is no separate GST field anywhere.
 */
// Reserved (ADR-0007, deferred): guaranteed vs conditional discount components. Always []
// until that ticket lands — typed `never` rather than an open shape so `discounts: Discount[]`
// can't silently accept malformed data before there's a real Discount shape to validate against.
export type Discount = never;

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

/**
 * A minimal shape check for a value loaded from storage. `load()` only gates on schemaVersion
 * (persistence.ts), not field shapes, and a Plan is the one persisted collection that flows
 * straight into arithmetic (computeFlatBill) — a malformed rate (non-numeric, or hand-edited
 * localStorage) would otherwise surface as a silent "$NaN" bill instead of being caught here.
 */
export function isValidPlan(value: unknown): value is Plan {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (typeof value.retailer !== 'string') return false;
  // Always [] until ADR-0007 lands (see Discount above) — a non-empty array is unsupported.
  if (!Array.isArray(value.discounts) || value.discounts.length !== 0) return false;

  const supply = value.supply;
  if (
    !isRecord(supply) ||
    !isFiniteNumber(supply.generalCentsPerDay) ||
    !isFiniteNumber(supply.cl1CentsPerDay) ||
    !isFiniteNumber(supply.cl2CentsPerDay)
  ) {
    return false;
  }

  const controlledLoad = value.controlledLoad;
  if (
    !isRecord(controlledLoad) ||
    !isFiniteNumber(controlledLoad.cl1RateCentsPerKwh) ||
    !isFiniteNumber(controlledLoad.cl2RateCentsPerKwh)
  ) {
    return false;
  }

  if (!isFiniteNumber(value.feedInRateCentsPerKwh)) return false;

  if (value.type === 'flat_rate') {
    const usage = value.usage;
    return isRecord(usage) && isFiniteNumber(usage.generalRateCentsPerKwh);
  }
  if (value.type === 'time_of_use') {
    return Array.isArray(value.touBands);
  }
  return false;
}
