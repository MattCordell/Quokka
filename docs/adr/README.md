# Architecture Decision Records

Decisions made while grilling the [PRD](../../electricity-comparison-tool-PRD.md). Each ADR is a rule the implementation tickets must honour. Use [0000-template.md](0000-template.md) for new records.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-tou-band-boundary-model.md) | TOU band boundaries are half-open intervals aligned to the register interval length | Accepted |
| [0002](0002-controlled-load-charges-require-circuit.md) | Controlled-load charges apply only when the household has that CL circuit | Accepted |
| [0003](0003-quality-flag-handling.md) | Sum interval values as-is (null = 0) and warn when a period contains non-actual reads | Accepted |
| [0004](0004-rounding-and-bill-sign.md) | Round only the final total; allow negative (net-credit) bills | Accepted* |
| [0005](0005-days-in-period.md) | Days-in-period is calendar days in the selected range, inclusive | Accepted |
| [0006](0006-annual-extrapolation.md) | Annual extrapolation scales per-band kWh + day-count, flags seasonal bias | Accepted |
| [0007](0007-discount-guaranteed-vs-conditional.md) | Discounts model guaranteed vs conditional, show both totals | Accepted |
| [0008](0008-usage-persistence.md) | Persist usage in local storage by NMI, with a clear control | Accepted |
| [0009](0009-last-quarter-definition.md) | "Last quarter" = most recent 3 full calendar months, partial dropped | Accepted |
| [0010](0010-multi-nmi-file-handling.md) | Multi-NMI file prompts NMI selection; never merges properties | Accepted |
| [0011](0011-register-mapping-cardinality.md) | Many registers may map to one category; kWh summed | Accepted |
| [0012](0012-uom-handling.md) | Accept energy UOMs (convert Wh/MWh); reject power units | Accepted |
| [0013](0013-tech-stack.md) | Tech stack: TypeScript + Vite + Svelte, static-built for Pages | Accepted |
| [0014](0014-charting-layerchart.md) | Charting: LayerChart (Svelte-native), bundled locally | Accepted |
| [0015](0015-v1-scope-and-sequencing.md) | V1 walking skeleton + scope; legacy CSV & CDR deferred | Accepted |

\* ADR-0004 accepted with a noted open tension (calibration accuracy). See the record.

## Still open

- **NEM12 interval labelling** (interval-ending vs interval-beginning) — a fact about the data, to be confirmed empirically against the supplied file inside the parser ticket ([ADR-0015](0015-v1-scope-and-sequencing.md)).
