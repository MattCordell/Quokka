# ADR 0015: V1 walking skeleton is import→map→flat-plan→total; legacy CSV deferred post-V1

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

The PRD is broad. To turn it into a buildable ticket sequence, V1 needs a defined first vertical slice and a clear line between what ships in V1 and what is deferred.

## Decision

**Walking skeleton (first end-to-end slice):** NEM12 import → **Register Mapping** → one **flat-rate** plan → **Bill** total, persisted, running on the real supplied file. This proves parse + map + calc + persistence on the simplest tariff before any breadth.

**Layer onto the skeleton, in roughly this order:** TOU plans + band editor with coverage validation ([ADR-0001](0001-tou-band-boundary-model.md)) → manual single-bill entry + **Calibration Check** (§7.5) → multi-plan **Comparison** view + usage-shape chart ([ADR-0014](0014-charting-layerchart.md)) → period presets (last quarter / annual extrapolation, [ADR-0006](0006-annual-extrapolation.md), [ADR-0009](0009-last-quarter-definition.md)) → plan/library JSON import-export.

**Deferred to post-V1:**
- **Legacy CSV fallback parser** and its shape-based channel heuristic (§5.4, §6) — NEM12 covers the user's own property; build only if a non-NEM12 retailer is actually encountered.
- **All CDR API integration** (PRD §9) — remains Phase 2 as already specified.

**Engineering guardrail:** the calc engine is a standalone TypeScript module with unit tests, and a **golden calibration test** asserts the engine reproduces the real invoice within tolerance — this is the acceptance gate before the comparison view is trusted.

## Consequences

- Tickets have a natural dependency spine; each layer is demoable.
- V1 stays lean (one import format, energy-only, no market-wide data).
- Deferring legacy CSV removes the heuristic + its confirmation UI from V1 entirely.
- The interval-labelling convention (the one remaining open item) must be confirmed against the real file inside the first (parser) ticket, before the flat-plan total is trusted.

## Alternatives considered

- **Calc engine first, headless.** Safest for math but slower to a visible result; the golden calibration test captures the safety benefit without gating all UI behind it.
- **UI-first with mock data.** Risks parse/calc landing late. Rejected.
- **Legacy CSV in V1.** More parsers/tests/UI for a path the user may never need. Rejected.
