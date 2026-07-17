import { describe, expect, it } from 'vitest';
import { isValidPlan } from './types';
import type { FlatPlan, TouPlan } from './types';

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

function validTouPlan(): TouPlan {
  return {
    id: 'plan-tou',
    name: 'Test TOU Plan',
    retailer: 'Test Co',
    type: 'time_of_use',
    supply: { generalCentsPerDay: 110, cl1CentsPerDay: 5, cl2CentsPerDay: 0 },
    touBands: [],
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

  it('rejects a TOU plan whose touBands is missing or not an array', () => {
    expect(isValidPlan(omit(validTouPlan(), 'touBands'))).toBe(false);
    expect(isValidPlan({ ...validTouPlan(), touBands: 'nope' })).toBe(false);
  });

  it('rejects an unrecognised plan type', () => {
    expect(isValidPlan({ ...validFlatPlan(), type: 'demand' })).toBe(false);
  });
});
