# ADR 0006: Annual extrapolation scales per-TOU-band kWh and the day-count, and flags seasonal bias

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

The "annual" **Billing Period** (§7.3) sums actuals when ≥ 365 days exist, else extrapolates. A naive "scale the total kWh" approach loses the **TOU** usage shape, which would mis-rank TOU-vs-flat plans — the whole point of the tool. (The supplied sample has 398 days, so this only affects shorter datasets.)

The available interval history is **provider-dependent and variable** — a user may hold anything from a few weeks to ~2 years (Origin supports ~2 years; other retailers differ). "Annual" must therefore normalise to a true 365-day figure in **both** directions, never a raw sum of whatever span happens to be loaded.

## Decision

"Annual" always yields a normalised 365-day figure:

- **If `days_available` ≥ 365:** use the **most recent 365 calendar days** in the data (recent and a single full seasonal cycle), sum actuals, no scaling, no extrapolation badge. Do **not** sum more than 365 days — a 2-year file must not report a 2-year total.
- **If `days_available` < 365:** compute `factor = 365 / days_available` (days_available per [ADR-0005](0005-days-in-period.md)), then
  - **scale each TOU band's summed kWh by `factor`** (and General/CL/Generation totals likewise), preserving the measured usage shape so TOU pricing stays representative;
  - **scale the supply-charge day-count to 365;**
  - **label the result an *extrapolated estimate*** and **warn it may be seasonally biased** (e.g. a winter-only sample over-weights heating).

The supplied sample is exactly 365 days, so it uses the most-recent-365 path with no extrapolation.

## Consequences

- TOU shape is preserved through extrapolation, so rankings remain meaningful.
- The seasonal-bias warning sets honest expectations; we are not claiming a partial-year sample is a true annual figure.
- Extrapolation is a presentation mode over the same per-band aggregation the engine already produces — no separate code path for the numbers, only the scaling factor and labels.

## Alternatives considered

- **Scale total kWh only.** Collapses to this approach once bands are priced, unless band proportions are ignored — which mis-ranks TOU. Rejected.
- **Disable annual unless ≥ 365 days.** Removes guesswork but also removes a useful view for shorter datasets; the estimate + bias warning is a better tradeoff. Rejected.
