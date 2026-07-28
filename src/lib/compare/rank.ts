import type { Bill } from '../calc/types';
import type { Plan } from '../plan/types';

export type RankBasis = 'bestCase' | 'guaranteed';

export interface PlanBill {
  plan: Plan;
  bill: Bill;
}

export interface RankedPlanBill extends PlanBill {
  rank: number;
  isCheapest: boolean;
  deltaCents: number;
}

export function basisTotal(bill: Bill, basis: RankBasis): number {
  return basis === 'guaranteed' ? bill.guaranteedTotalCents : bill.bestCaseTotalCents;
}

/**
 * Ranks plans cheapest-first on the given basis. Sorts on the *rounded* total (basisTotal, not
 * full precision), so the order can never disagree with the number printed beside it — full
 * precision could rank one plan above another while both display the same rounded string.
 *
 * Ties share a dense rank and are all `isCheapest`: two plans costing the same cent must not be
 * shown as a winner and a runner-up. The tiebreak falls back to `plan.name.localeCompare` so the
 * list doesn't reshuffle order on an unrelated re-render.
 */
export function rankPlanBills(rows: PlanBill[], basis: RankBasis): RankedPlanBill[] {
  const sorted = [...rows].sort((a, b) => {
    const diff = basisTotal(a.bill, basis) - basisTotal(b.bill, basis);
    return diff !== 0 ? diff : a.plan.name.localeCompare(b.plan.name);
  });

  const cheapestTotal = sorted.length > 0 ? basisTotal(sorted[0].bill, basis) : 0;

  let rank = 0;
  let lastTotal: number | null = null;
  return sorted.map((row) => {
    const total = basisTotal(row.bill, basis);
    if (lastTotal === null || total !== lastTotal) {
      rank += 1;
      lastTotal = total;
    }
    return {
      ...row,
      rank,
      isCheapest: total === cheapestTotal,
      deltaCents: total - cheapestTotal,
    };
  });
}
