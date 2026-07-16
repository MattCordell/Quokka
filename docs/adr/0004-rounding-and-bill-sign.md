# ADR 0004: Round only the final total; allow negative (net-credit) bills

- **Status:** Accepted (see open tension in Consequences)
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

Two arithmetic conventions affect whether the **Calibration Check** (§7.5) can match a printed invoice, and how solar-heavy scenarios display:
1. Rounding — per line component, or only the final total.
2. Sign — can a **Bill** total go negative when the **Solar Credit** exceeds charges.

## Decision

- **Compute every component at full precision and round only the final total** to the cent.
- **Allow negative totals.** A period where feed-in credit exceeds charges shows as a negative (credit) total; it is not clamped to $0.

## Consequences

- Simple, artefact-free internal arithmetic; no compounding of per-line rounding.
- Solar-heavy periods honestly show a net credit rather than a misleading $0 floor.
- **Open tension:** real invoices round *per line item*, so the Calibration Check (§7.5) may differ from the printed bill by a cent or two — precisely the comparison calibration exists to make exact. This was raised in grilling; decision stands unless calibration accuracy proves it wrong in practice, at which point revisit toward per-line rounding. Recorded here so the tradeoff is explicit, not discovered later.

## Alternatives considered

- **Round each line to the cent, allow negative.** Matches invoice line-item presentation and would let calibration hit the invoice exactly; not chosen for V1 in favour of internal simplicity.
- **Round per line, clamp negatives to $0.** Hides over-credit and distorts ranking of solar-heavy plans. Rejected.
