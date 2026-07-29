# ADR 0017: Plan export format and import conflict handling

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** Matt Cordell

## Context

Plans persist only in browser local storage ([ADR-0008](0008-usage-persistence.md)); clearing
browser data destroys the library, and there is no way to move plans between devices. PRD §7.1
requires import/export of a single Plan or the whole library as JSON, with create/edit/duplicate/
delete. This is the user's only backup path in V1, so the format and the conflict-handling
behaviour need to be settled deliberately rather than improvised in the ticket that implements
them.

Three questions needed an answer before implementation:

1. What exact JSON shape does export write, and what shapes does import accept?
2. What happens when an imported plan's id or name collides with one already in the library?
3. How far does import validation go — does it re-run the same invariants the plan editor
   enforces (Band Coverage, boundary alignment), or trust the file?

## Decision

**Export always writes a versioned envelope**, for a single plan and the whole library alike:

```json
{ "kind": "quokka-plan-library", "schemaVersion": 1, "exportedAt": "<ISO 8601>", "plans": [...] }
```

The envelope's `schemaVersion` is its **own constant**, independent of persistence's
`SCHEMA_VERSION` ([ADR-0008](0008-usage-persistence.md)). Coupling them would invalidate every
already-exported backup file the moment the storage envelope bumps for an unrelated reason (e.g.
a usage-shape change) — the two evolve on different clocks.

**Import is more permissive than export.** It accepts the envelope above, a bare `Plan[]`, or a
bare single `Plan` object — this is what lets `fixtures/plans/*.json` (single bare Plan objects
with a non-schema `_note` field) import as-is, and lets a user hand-share one plan without
wrapping it. Anything else (not JSON, or JSON that is none of these three shapes) is rejected with
a message naming what was found. Unknown top-level or nested fields (like fixtures' `_note`) are
**stripped from the stored plan but reported** as a note — nothing is silently dropped, but nothing
unrecognised round-trips into local storage either.

**Imported TOU plans re-run full validation before saving** — Band Coverage, boundary alignment,
no Gap/Overlap — at exactly the bar the plan editor already enforces
([ADR-0001](0001-tou-band-boundary-model.md)). A plan whose bands don't clear that bar is rejected,
not admitted with a warning; `persistence.ts`'s tolerance of coverage-invalid plans already in
storage is a load-time safety net for hand-edited data, not license to admit new invalid plans
through import. Before that check runs, a band expressed with an inclusive end (e.g. `20:59`) is
normalised to the exclusive form actually stored (`21:00`) — the transform ADR-0001's Consequences
already named import as the intended caller for. Validation runs on a fixed 30-minute grid,
independent of any loaded usage — the same grid the editor validates on, safe for 5/15/30-minute
register data alike, and it keeps the import module free of any NMI/usage dependency.

**Collisions are handled per-plan, not with a single blanket rule.** Importing into an existing
library detects a collision by id first, then by name+retailer (trimmed, case-insensitive) if the
id doesn't already match. Each colliding plan gets an explicit choice — **Skip**, **Keep both**, or
**Overwrite** — defaulting to Keep both, the non-destructive option. Keep both mints a fresh id and
suffixes the name (`"<name> (imported)"`, escalating to `(imported 2)` on a further collision),
leaving the original plan untouched; Overwrite replaces the colliding entry in its existing list
position, keeping the existing id, so the plan table doesn't reshuffle and nothing else that
referenced that id breaks. A non-colliding plan is simply added.

**Import offers both merge and replace at the whole-library level.** Merge adds accepted plans
into the existing library (per the per-plan choices above). Replace wipes the library and restores
it from the imported file exactly — collision choices are moot here since nothing survives to
collide with — gated behind a confirmation step naming both counts (imported vs currently saved),
mirroring the existing single-plan delete confirmation pattern.

## Consequences

- A schema-version field on the export file means a future format change can migrate old backups
  instead of silently misreading or corrupting them.
- Round-trip fidelity (export → import) is the acceptance bar: a plan's TOU bands, day lists, and
  discount records must survive unchanged, which the golden calibration test now proves against
  the fixture plans and their known-good bill totals.
- Import validation duplicates none of the plan editor's coverage logic — it calls the same
  `analyzeCoverage`/`normalizeInclusiveEnd` functions the editor doesn't currently wire up, giving
  those functions their first real caller.
- The per-plan collision review adds UI complexity (a review list with per-row choices) that a
  blanket "always overwrite" or "always skip" policy would have avoided — accepted because a
  silent overwrite or silent skip on someone's only backup path is a worse failure mode than an
  extra click.
- Replace mode is destructive by construction; the two-step confirm is the only guard against an
  accidental whole-library wipe from a bad file pick.

## Alternatives considered

- **Bare `Plan[]` as the only export shape (no envelope).** Simpler, but gives up the
  forward-migration hook a schema-version field provides, and ADR-0008 already flagged that
  omission as a risk for the sibling storage envelopes. Rejected.
- **Blanket import policy (always overwrite by id, or always add as new).** Removes the review
  step but risks silently destroying a plan the user didn't intend to replace, or silently
  duplicating one they meant to update. Rejected in favour of an explicit per-plan choice.
- **Trust the file's Band Coverage (skip re-validation on import).** Faster to implement, but lets
  a hand-edited or corrupted file introduce a plan the editor itself could never have produced,
  contradicting the glossary's "must be impossible to save" invariant for Gap/Overlap. Rejected.
