/** Integer cents -> a signed "$X.XX" string (e.g. -140 -> "-$1.40"). */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  return `${sign}$${Math.abs(dollars).toFixed(2)}`;
}
