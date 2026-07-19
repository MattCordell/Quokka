import { describe, expect, it } from 'vitest';
import { isValidPlan } from './types';
import type { FlatPlan, TouBand, TouPlan } from './types';

function validFlatPlan(): FlatPlan {
  return {
    id: 'plan-a',
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

function omit<T extends object>(value: T, key: keyof T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key as string];
  return copy;
}

function validBand(): TouBand {
  return {
    label: 'All week',
    startTime: '00:00',
    endTime: '24:00',
    rateCentsPerKwh: 25,
    days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  };
}

function validTouPlan(): TouPlan {
  return {
    id: 'plan-tou',
    name: 'Test TOU Plan',
    retailer: 'Test Co',
    type: 'time_of_use',
    supply: { generalCentsPerDay: 110, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    touBands: [validBand()],
    controlledLoad: { cl1RateCentsPerKwh: 20, cl2RateCentsPerKwh: 0 },
    feedInRateCentsPerKwh: 5,
    discounts: [],
  };
}

describe('isValidPlan', () => {
  it('accepts a well-formed flat plan', () => {
    expect(isValidPlan(validFlatPlan())).toBe(true);
  });

  it('accepts a well-formed TOU plan', () => {
    expect(isValidPlan(validTouPlan())).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isValidPlan(null)).toBe(false);
    expect(isValidPlan(undefined)).toBe(false);
    expect(isValidPlan('plan')).toBe(false);
    expect(isValidPlan(42)).toBe(false);
  });

  it('rejects a non-numeric usage rate (the NaN-bill scenario)', () => {
    expect(isValidPlan({ ...validFlatPlan(), usage: { generalRateCentsPerKwh: 'oops' } })).toBe(
      false,
    );
  });

  it('rejects a missing id, name, or retailer', () => {
    expect(isValidPlan(omit(validFlatPlan(), 'id'))).toBe(false);
    expect(isValidPlan(omit(validFlatPlan(), 'name'))).toBe(false);
    expect(isValidPlan(omit(validFlatPlan(), 'retailer'))).toBe(false);
  });

  it('rejects a non-empty discounts array (unsupported pending ADR-0007)', () => {
    expect(isValidPlan({ ...validFlatPlan(), discounts: [{ kind: 'guaranteed' }] })).toBe(false);
  });

  it('rejects malformed supply or controlledLoad rate fields', () => {
    expect(
      isValidPlan({
        ...validFlatPlan(),
        supply: { generalCentsPerDay: null, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
      }),
    ).toBe(false);
    expect(
      isValidPlan({
        ...validFlatPlan(),
        controlledLoad: { cl1RateCentsPerKwh: 20 },
      }),
    ).toBe(false);
  });

  it('rejects a non-finite feedInRateCentsPerKwh', () => {
    expect(isValidPlan({ ...validFlatPlan(), feedInRateCentsPerKwh: Infinity })).toBe(false);
  });

  it('rejects a flat plan missing its usage block', () => {
    expect(isValidPlan(omit(validFlatPlan(), 'usage'))).toBe(false);
  });

  it('rejects a TOU plan whose touBands is missing, not an array, or empty', () => {
    expect(isValidPlan(omit(validTouPlan(), 'touBands'))).toBe(false);
    expect(isValidPlan({ ...validTouPlan(), touBands: 'nope' })).toBe(false);
    expect(isValidPlan({ ...validTouPlan(), touBands: [] })).toBe(false);
  });

  it('rejects a TOU band with a non-numeric rate (the NaN-bill scenario)', () => {
    const band = { ...validBand(), rateCentsPerKwh: 'oops' };
    expect(isValidPlan({ ...validTouPlan(), touBands: [band] })).toBe(false);
  });

  it('rejects a TOU band with a malformed time', () => {
    expect(
      isValidPlan({
        ...validTouPlan(),
        touBands: [{ ...validBand(), startTime: '9am' }],
      }),
    ).toBe(false);
    expect(
      isValidPlan({
        ...validTouPlan(),
        touBands: [{ ...validBand(), endTime: '25:00' }],
      }),
    ).toBe(false);
  });

  it('accepts the "24:00" end-of-day sentinel for endTime', () => {
    expect(
      isValidPlan({ ...validTouPlan(), touBands: [{ ...validBand(), endTime: '24:00' }] }),
    ).toBe(true);
  });

  it('rejects the "24:00" end-of-day sentinel as a startTime', () => {
    expect(
      isValidPlan({ ...validTouPlan(), touBands: [{ ...validBand(), startTime: '24:00' }] }),
    ).toBe(false);
  });

  it('rejects a TOU band with a missing label or an empty/invalid days list', () => {
    expect(isValidPlan({ ...validTouPlan(), touBands: [omit(validBand(), 'label')] })).toBe(false);
    expect(isValidPlan({ ...validTouPlan(), touBands: [{ ...validBand(), days: [] }] })).toBe(
      false,
    );
    expect(
      isValidPlan({ ...validTouPlan(), touBands: [{ ...validBand(), days: ['FUNDAY'] }] }),
    ).toBe(false);
  });

  it('rejects an unrecognised plan type', () => {
    expect(isValidPlan({ ...validFlatPlan(), type: 'demand' })).toBe(false);
  });
});
