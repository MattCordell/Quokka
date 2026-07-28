import { describe, expect, it } from 'vitest';
import { isValidDiscount, isValidPlan } from './types';
import type { Discount, FlatPlan, TouBand, TouPlan } from './types';

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

function validDiscount(): Discount {
  return {
    id: 'disc-a',
    label: 'Direct debit',
    kind: 'guaranteed',
    percent: 10,
    components: ['usage', 'supply'],
  };
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

  it('accepts a well-formed discounts list', () => {
    expect(
      isValidPlan({
        ...validFlatPlan(),
        discounts: [validDiscount(), { ...validDiscount(), id: 'disc-b', kind: 'conditional' }],
      }),
    ).toBe(true);
  });

  it('still accepts an empty discounts array', () => {
    expect(isValidPlan({ ...validFlatPlan(), discounts: [] })).toBe(true);
  });

  it('rejects a plan whose discounts contains a malformed entry', () => {
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

describe('isValidDiscount', () => {
  it('accepts a well-formed discount', () => {
    expect(isValidDiscount(validDiscount())).toBe(true);
  });

  it('accepts percent 0 and 100', () => {
    expect(isValidDiscount({ ...validDiscount(), percent: 0 })).toBe(true);
    expect(isValidDiscount({ ...validDiscount(), percent: 100 })).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isValidDiscount(null)).toBe(false);
    expect(isValidDiscount(undefined)).toBe(false);
    expect(isValidDiscount('discount')).toBe(false);
  });

  it('rejects a non-string or empty id', () => {
    expect(isValidDiscount({ ...validDiscount(), id: 42 })).toBe(false);
    expect(isValidDiscount({ ...validDiscount(), id: '' })).toBe(false);
  });

  it('rejects a non-string label', () => {
    expect(isValidDiscount({ ...validDiscount(), label: 42 })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isValidDiscount({ ...validDiscount(), kind: 'unconditional' })).toBe(false);
  });

  it('rejects a non-finite or out-of-range percent', () => {
    expect(isValidDiscount({ ...validDiscount(), percent: 'ten' })).toBe(false);
    expect(isValidDiscount({ ...validDiscount(), percent: -1 })).toBe(false);
    expect(isValidDiscount({ ...validDiscount(), percent: 101 })).toBe(false);
    expect(isValidDiscount({ ...validDiscount(), percent: Infinity })).toBe(false);
  });

  it('rejects a non-array or empty components list', () => {
    expect(isValidDiscount({ ...validDiscount(), components: 'usage' })).toBe(false);
    expect(isValidDiscount({ ...validDiscount(), components: [] })).toBe(false);
  });

  it('rejects an unknown component value', () => {
    expect(isValidDiscount({ ...validDiscount(), components: ['usage', 'gst'] })).toBe(false);
  });

  it('accepts duplicate components (parity with TouBand.days)', () => {
    expect(isValidDiscount({ ...validDiscount(), components: ['usage', 'usage'] })).toBe(true);
  });
});
