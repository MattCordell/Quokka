# ADR 0001: TOU band boundaries are half-open intervals aligned to the register interval length

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

PRD §5.1 shows TOU bands with inclusive minute-ends (`start_time: "16:00", end_time: "20:59"`). Interval data lands on fixed marks (`:00/:05/:10...` for 5-min data). An inclusive end of `20:59` does not fall on any 5-min mark, making it ambiguous which band the interval covering 20:55–21:00 belongs to, and forcing the band-coverage validator (§5.1, "exactly one band per hour") to reason about sub-interval minutes.

## Decision

Model every TOU band time span as a **half-open interval `[start_time, end_time)`** — start inclusive, end exclusive. The PRD's peak example becomes `16:00 → 21:00` (covers the 20:55 reading, excludes the 21:00 reading).

- **Boundary alignment invariant:** every band `start_time`/`end_time` must fall on a multiple of the General-usage register's **Interval Length**. The plan editor rejects a boundary that doesn't align.
- **Interval assignment:** an interval belongs to the single band whose `[start, end)` contains the interval's own time slot. Because boundaries align to interval marks, each interval falls wholly inside exactly one band — never split.
- **Bands may wrap midnight** (`21:00 → 16:00`); the validator treats the week as a circular 168-hour timeline.
- **Coverage check** operates on interval-length slots across all 168 weekly hours: exactly one band per slot, else name the gap/overlap.
- **Editor UX:** users still enter friendly local times ("ends 9:00 pm"); the friendly end maps to the exclusive boundary internally.

## Consequences

- The coverage/gap/overlap validator is exact and cheap (finite set of weekly slots), no floating-point time math.
- Existing/imported plans expressed with inclusive ends (`20:59`, and future CDR imports) must be normalised to exclusive ends (`21:00`) on entry — a documented import transform, not a silent reinterpretation.
- A band boundary that doesn't align to the interval length is a hard validation error, not a rounding fudge. If a retailer ever publishes a boundary off the interval grid, we revisit.
- Assignment is by the interval's slot, independent of the interval-ending/beginning labelling question (tracked separately) — that question only shifts the whole series by one slot, it does not change this model.

## Alternatives considered

- **Inclusive minute-ends, assign by interval start instant.** Easier literal transcription from a plan PDF, but pushes sub-interval reasoning into both the assignment engine and the validator, and leaves the 20:59-vs-21:00 ambiguity live. Rejected.
