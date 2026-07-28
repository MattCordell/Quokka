import { describe, expect, it } from 'vitest';
import { priceDiscounts } from './discount';
import type { Discount } from '../plan/types';

function discount(overrides: Partial<Discount> = {}): Discount {
  return {
    id: 'disc-1',
    label: 'Test discount',
    kind: 'guaranteed',
    percent: 10,
    components: ['usage', 'supply'],
    ...overrides,
  };
}

describe('priceDiscounts', () => {
  it('prices a guaranteed-only discount', () => {
    const result = priceDiscounts([discount({ kind: 'guaranteed', percent: 10 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines[0].baseCents).toBe(1000);
    expect(result.lines[0].cents).toBe(100);
    expect(result.guaranteedCents).toBe(100);
    expect(result.conditionalCents).toBe(0);
  });

  it('prices a conditional-only discount', () => {
    const result = priceDiscounts([discount({ kind: 'conditional', percent: 5 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.guaranteedCents).toBe(0);
    expect(result.conditionalCents).toBe(50);
  });

  it('prices both a guaranteed and a conditional discount', () => {
    const result = priceDiscounts(
      [
        discount({ id: 'g', kind: 'guaranteed', percent: 10 }),
        discount({ id: 'c', kind: 'conditional', percent: 5 }),
      ],
      { supplyCents: 200, usageCents: 800 },
    );
    expect(result.guaranteedCents).toBe(100);
    expect(result.conditionalCents).toBe(50);
    expect(result.lines).toHaveLength(2);
  });

  it("bases ['usage'] on usage only, not supply", () => {
    const result = priceDiscounts([discount({ components: ['usage'], percent: 50 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines[0].baseCents).toBe(800);
    expect(result.lines[0].cents).toBe(400);
  });

  it("bases ['usage','supply'] on both", () => {
    const result = priceDiscounts([discount({ components: ['usage', 'supply'], percent: 50 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines[0].baseCents).toBe(1000);
  });

  it("bases ['supply'] on supply only, not usage", () => {
    const result = priceDiscounts([discount({ components: ['supply'], percent: 50 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines[0].baseCents).toBe(200);
    expect(result.lines[0].cents).toBe(100);
  });

  it('sums two guaranteed discounts in parallel, not compounded (10%+10% off 1000 = 200, not 190)', () => {
    const result = priceDiscounts(
      [
        discount({ id: 'a', kind: 'guaranteed', percent: 10 }),
        discount({ id: 'b', kind: 'guaranteed', percent: 10 }),
      ],
      { supplyCents: 0, usageCents: 1000 },
    );
    expect(result.guaranteedCents).toBe(200);
  });

  it('counts a duplicate component only once', () => {
    const result = priceDiscounts([discount({ components: ['usage', 'usage'], percent: 10 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines[0].baseCents).toBe(800);
  });

  it('still emits a line for percent: 0', () => {
    const result = priceDiscounts([discount({ percent: 0 })], {
      supplyCents: 200,
      usageCents: 800,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].cents).toBe(0);
  });

  it('keeps full precision, unrounded', () => {
    const result = priceDiscounts([discount({ percent: 33.333, components: ['usage'] })], {
      supplyCents: 0,
      usageCents: 100,
    });
    expect(result.lines[0].cents).toBeCloseTo(33.333, 10);
  });

  it('returns zeroed totals for an empty discount list', () => {
    const result = priceDiscounts([], { supplyCents: 200, usageCents: 800 });
    expect(result.lines).toEqual([]);
    expect(result.guaranteedCents).toBe(0);
    expect(result.conditionalCents).toBe(0);
  });
});
