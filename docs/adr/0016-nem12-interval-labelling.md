# ADR 0016: NEM12 interval labelling — `values[0]` is the midnight-starting slot

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Matt Cordell; parser ticket (#3)

## Context

PRD §0 left one open question: whether a NEM12 register's interval array is labelled by
interval-**ending** or interval-**beginning** time. Assumed wrong, the whole series shifts by
one slot, which — combined with ADR-0001's half-open, slot-based TOU assignment — would
silently misassign every interval to the wrong TOU band.

**Confirmed empirically** against the real (git-ignored) Origin NEM12 export, without quoting any
of its actual readings here (this repo is public — see Data & privacy in the root `CLAUDE.md`):
parsed the `B1` (solar generation) register's 5-minute intervals for a clean `A`-quality day and
inspected the shape using the parser under test. Generation is near-zero overnight and rises to a
single midday peak with a plausible sunrise/sunset start and end time for the sampled day — this
shape is only consistent with `values[0]` representing the slot `[00:00, 00:05)` measured from
midnight, i.e. index 0 is the *first* slot of the day, not an off-by-one carried over from the
previous day's last slot.

A generation register mislabelled by one slot would still show a plausible-looking solar curve
(the shift is invisible against a smooth signal at day-boundary granularity), but a full-day or
reversed-order mislabelling would not produce an overnight-zero / single-midday-peak shape at all
— which is the failure mode this check rules out.

## Decision

`RegisterDay.values[i]` is defined as the kWh reading for the local-time slot
`[i * intervalLength, (i + 1) * intervalLength)` minutes from midnight. Index 0 is always the
day's first slot. This is documented as the contract in [`types.ts`](../../src/lib/nem12/types.ts).

## Consequences

- Closes the last open item in PRD §0 and the ⚠ OPEN note on the glossary's **Interval** entry.
- TOU band assignment (ADR-0001) can proceed slot-by-slot with index 0 = midnight, no
  compensating offset.
- The check is coarse (day-shape, not slot-precise) — it would not catch a genuine off-by-one
  against a smooth generation curve. If a future ticket needs slot-precise confirmation, cross-
  check one day's 5-minute values against the legacy CSV format's explicit `From`/`To`
  timestamps (same household, overlapping date range).

## Alternatives considered

- **Assume interval-ending per the AEMO NEM12 spec's literal wording.** In most real-world
  parsers this resolves to the same `values[0] = [00:00,00:05)` convention adopted here, but
  taking it as read without checking the actual file was the risk this ADR closes out.
- **Cross-check against the legacy CSV file's explicit timestamps first.** Considered, but the
  legacy export's date range doesn't overlap the NEM12 export's; the day-shape check on the
  generation register was sufficient and available immediately.
