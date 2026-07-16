# ADR 0003: Sum interval values as-is (null = 0) and warn when a period contains non-actual reads

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

NEM12 intervals carry a **Quality Flag**. **Confirmed against the supplied file** (not just the spec): the `300` day-level flag is `A` (actual, 1070 days) or `V` (variable, 25 days). `V` does **not** mean "estimated" — it means the day has *mixed* quality and the per-interval truth lives in that day's `400` records. The `400` records use the form `400,startInterval,endInterval,qualityMethod,reasonCode,` — e.g. `400,153,158,F19,79,` marks intervals 153–158 as `F` (final substitute = estimated), method 19, reason 79. The file has 89 such `400` rows. No `S` or `N` flags occur in this file, though the spec permits them. The engine needs a defined rule for how these participate in a period sum, and a threshold for warning the user.

## Decision

1. **Resolve per-interval quality**: for an `A` day, all intervals are actual; for a `V` day, read the day's `400` records and apply each `start..end` range's flag to those intervals (default any interval not covered by a `400` range to actual).
2. **Sum all interval values as provided**, including substituted (`F`, and `S` if ever present) values — they are the numbers the retailer would itself bill on.
3. **Treat null (`N`) intervals as `0 kWh`** in the sum (defensive — none occur in the sample, but the spec permits them). The warning tells the user the period isn't wholly actual.
4. **Warn when the selected Billing Period contains any non-actual interval** (`F`/`S`/`N`, i.e. any resolved flag other than `A`). Surface it as a visible badge, e.g. "This period includes estimated or substituted reads on N days."
5. Carry the resolved flags through parsing so the warning is computable for any date range.

## Consequences

- The primary use case (the sample file, which has estimated months) is never blocked.
- Nulls understate usage; the warning is the mitigation, and the user can choose a cleaner date range if they want a purer comparison.
- The warning must be date-range-aware: computed over the *selected* period, not the whole file.
- **Follow-up (Round 2):** how "days in period" (supply-charge multiplier) treats days that are entirely null is still open — see the Days-in-Period decision.

## Alternatives considered

- **Exclude null intervals from usage and day-count.** Avoids understatement but complicates the supply-charge day count and the "why is my usage lower than the bill" story. Rejected for V1.
- **Refuse to compute if any non-actual reads.** Safest integrity stance but blocks the sample data outright. Rejected.
