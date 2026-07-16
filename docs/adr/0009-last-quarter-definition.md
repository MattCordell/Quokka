# ADR 0009: "Last quarter" = the most recent 3 full calendar months, partial trailing month dropped

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

PRD §7.3 offers a "last quarter" **Billing Period** = "most recent 3 full calendar months in the dataset." Real data often ends mid-month, leaving a partial trailing month whose treatment was undefined.

## Decision

"Last quarter" = the three most recent **complete** calendar months present in the data. A trailing partial month is excluded from the quarter (it remains reachable via a custom range). Example: data ending 14 Jul → quarter = 1 Apr – 30 Jun.

If three complete calendar months do not exist in the data, the "last quarter" preset is disabled (custom range still available).

## Consequences

- The quarter is always a clean 3 months, so supply-charge day counts and comparisons are unambiguous.
- Recency is traded slightly (the newest partial month is omitted from the preset) for cleanliness — acceptable since custom range covers it.

## Alternatives considered

- **Include the partial trailing month.** More recent but yields a ragged ~91-day period that muddies supply-day comparison. Rejected.
