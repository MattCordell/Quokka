# ADR 0013: Tech stack is TypeScript + Vite + Svelte, static-built for GitHub Pages

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

V1 is a static, client-side, zero-backend site (§8) that nonetheless runs a money-and-tariff **Bill** engine where correctness is paramount. The stack must build to static files for GitHub Pages, keep the bundle small, and give the calculation engine type safety.

## Decision

- **Language:** TypeScript throughout — especially the calculation engine, plan schema, and NEM12 parser, where types guard the arithmetic and the tariff model.
- **Build:** Vite, producing static `/dist` output deployable directly to GitHub Pages (base path configured for the repo).
- **UI framework:** Svelte — compiles to minimal JS, no virtual-DOM overhead, good fit for the reactive plan editor and comparison table.

## Consequences

- The calc engine should be a framework-agnostic TypeScript module (`.ts`, no Svelte imports) so it is unit-testable in isolation and reusable if the UI ever changes — this also serves the calibration golden-test ([ADR-0004](0004-rounding-and-bill-sign.md), [ADR-0015](0015-v1-scope-and-sequencing.md)).
- Charting is coupled to Svelte via [ADR-0014](0014-charting-layerchart.md).
- Vite `base` must be set to the Pages sub-path; a deploy workflow (GitHub Actions building to Pages) is the one piece of "infra," consistent with §8's static goal.
- A test runner (Vitest, native to Vite) is assumed for the engine tests.

## Alternatives considered

- **TS + Vite + React** — larger runtime; fine but heavier for a small app. Not chosen.
- **Vanilla TS** — more UI boilerplate for reactive views. Not chosen.
- **Plain JS, no build** — no type safety on money math; rejected.
