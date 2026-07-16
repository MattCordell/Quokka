# ADR 0014: Charting uses LayerChart (Svelte-native), bundled locally — no CDN

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

The usage-shape chart (kWh by hour-of-day, or % of general usage per **TOU Band**) is the tool's differentiator (§7.6). Charts must be fully self-contained — no external CDN — to honour the privacy posture and a strict CSP (§8), and should fit the Svelte choice ([ADR-0013](0013-tech-stack.md)).

## Decision

Use **LayerChart** (Svelte-native, built on LayerCake/D3), installed as an npm dependency and bundled into the static build. No runtime fetches to external hosts.

## Consequences

- Charts are declarative Svelte components, consistent with the UI stack.
- All chart code ships in the bundle; nothing loads from a CDN, satisfying CSP/privacy.
- Couples charting to the Svelte framework — acceptable given the stack is fixed.
- If a specific chart (e.g. an hour-of-day heatmap) proves awkward in LayerChart, a hand-rolled SVG component remains a local fallback with no new dependency.

## Alternatives considered

- **uPlot** — tiny and fast, framework-agnostic; strong option, but LayerChart integrates more naturally with Svelte for the mix of bar/area/interval views. Close second.
- **Chart.js** — larger, canvas-based, not Svelte-native. Not chosen.
- **Hand-rolled SVG** — zero deps but more effort for axes/tooltips; kept as a per-chart fallback.
