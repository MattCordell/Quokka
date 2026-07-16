# ADR 0005: Days-in-period is calendar days in the selected range, inclusive

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

The **Supply Charge** = c/day × days-in-period (§7.4) and must match a real invoice. A retailer bills the daily supply charge for every day the connection exists, regardless of whether usage was recorded, zero, or estimated. This also resolves the open follow-up from [ADR-0003](0003-quality-flag-handling.md): how do entirely-null days count.

## Decision

**Days-in-period = the count of calendar days in the selected Billing Period, inclusive of both the start and end date.** A period of 1 Jan → 31 Mar is 90 days. Days that are zero-usage, entirely null, or estimated are all counted — the supply charge applies to every connected day.

The selectable range is bounded by the span of imported data (§7.2), so "calendar days in range" cannot exceed the data's coverage, but *within* that span, gaps or null days do not reduce the day count.

## Consequences

- Supply-charge arithmetic matches invoice convention, supporting the Calibration Check.
- Resolves ADR-0003's open item: null/estimated days still incur supply charge (only their *usage* is affected).
- If the imported file has whole missing calendar days *inside* a selected range, they are still charged supply — acceptable, because the range picker is bounded to real data and a fully missing interior day is rare and already surfaced by the non-actual-reads warning.
- "Inclusive of both endpoints" must be implemented deliberately (`end − start + 1`), a classic off-by-one; worth an explicit test against a known invoice.

## Alternatives considered

- **Distinct dates present in the file.** Undercounts supply vs a real bill when gap days exist. Rejected.
- **Calendar days minus entirely-null days.** Diverges from how retailers bill (they charge supply on estimated/null days). Rejected.
