/**
 * The Plan schema, codified from fixtures/plans/{flat-plan,tou-plan}.json. All rates are
 * integer cents, GST-inclusive (PRD 7.4) — there is no separate GST field anywhere.
 */
export interface Discount {
  // Reserved (ADR-0007, deferred): guaranteed vs conditional discount components.
  // Left open so the schema round-trips through persistence unchanged until that ticket.
  [key: string]: unknown;
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
