import type { Discount, DiscountComponent, DiscountKind } from '../plan/types';

/**
 * ADR-0007: discounts are additive, never compounded — two 10% discounts take 20% of the base,
 * not 19%. The guaranteed/best-case totals are each defined as "base less the sum of applicable
 * discount percentages", and retailers quote "% off" against the list rate, so summing matches
 * how a real offer reads.
 */
export interface DiscountLine {
  discountId: string;
  label: string;
  kind: DiscountKind;
  percent: number;
  components: DiscountComponent[];
  /** The subtotal this percent applied to; never includes the Solar Credit. */
  baseCents: number;
  /** baseCents * percent / 100; positive = a reduction. */
  cents: number;
}

export interface DiscountBreakdown {
  lines: DiscountLine[];
  guaranteedCents: number;
  conditionalCents: number;
}

/** usage = General + CL1 + CL2 usage cents (ADR-0007 clarification); supply = the daily supply charge. */
export interface DiscountableCharges {
  supplyCents: number;
  usageCents: number;
}

/**
 * Prices every discount on a Plan against already-computed charge subtotals. Each discount's
 * base is a membership test over its `components`, not an iteration — a duplicated component
 * entry must not double-count a charge.
 */
export function priceDiscounts(
  discounts: readonly Discount[],
  charges: DiscountableCharges,
): DiscountBreakdown {
  const lines: DiscountLine[] = discounts.map((d) => {
    const baseCents =
      (d.components.includes('usage') ? charges.usageCents : 0) +
      (d.components.includes('supply') ? charges.supplyCents : 0);
    const cents = (baseCents * d.percent) / 100;
    return {
      discountId: d.id,
      label: d.label,
      kind: d.kind,
      percent: d.percent,
      components: d.components,
      baseCents,
      cents,
    };
  });

  const guaranteedCents = lines
    .filter((l) => l.kind === 'guaranteed')
    .reduce((sum, l) => sum + l.cents, 0);
  const conditionalCents = lines
    .filter((l) => l.kind === 'conditional')
    .reduce((sum, l) => sum + l.cents, 0);

  return { lines, guaranteedCents, conditionalCents };
}
