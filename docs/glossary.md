# Glossary — QLD Electricity Plan Comparison Tool

The domain model for the tool. The purpose is a single computation: given a **Household**'s real **Interval** usage and a **Plan**'s **Tariff**, produce the **Bill** that plan *would have* charged — precisely enough to trust the ranking in the **Comparison**.

**Bold terms** are defined elsewhere in this glossary. A ⚠ **OPEN** tag marks a definition still being decided in the grilling; the linked ADR resolves it once accepted.

---

## Plan & Tariff

### Plan
A saved, user-authored record describing one retailer offer. Owns a **Tariff**, metadata (name, retailer), and a **Discount** definition. Persisted in browser local storage; import/export as JSON. Not the same as a **Bill** — a Plan is the *rule*, a Bill is the *result* of applying the rule to usage.

### Tariff
The rate structure inside a **Plan**: a **Supply Charge** component, a **Usage Charge** component (either flat or **TOU**), optional **Controlled Load** rates, and a **Feed-in Rate**. Either `flat_rate` or `time_of_use`.

### Supply Charge
A fixed c/day cost independent of usage. The tool's *combined* supply charge = General + **Controlled Load** 1 + CL2 daily charges — but a CLn charge is included **only if a register is mapped to CLn** for this household ([ADR-0002](adr/0002-controlled-load-charges-require-circuit.md)).

### Usage Charge
The cost of imported energy. Flat: `kWh × rate`. **TOU**: sum over **TOU Bands**.

### TOU (Time-of-Use)
A **Tariff** whose usage rate depends on *when* energy was imported, defined as a set of **TOU Bands**.

### TOU Band
One rate that applies to a set of (day-of-week, time-of-day) slots: `{label, start_time, end_time, rate, days[]}`, where the span is **half-open `[start, end)`** with boundaries aligned to the register **Interval Length** ([ADR-0001](adr/0001-tou-band-boundary-model.md)). `days` is an explicit list of `MON`..`SUN` (not weekday/weekend shorthand), matching the CDR schema. Bands may wrap midnight.

### Band Coverage (invariant)
The rule that a valid **TOU** tariff's bands cover every moment of all 168 hours of the week exactly once — no **Gap**, no **Overlap**. Checked on the finite set of interval-length slots across the circular weekly timeline before a Plan can be saved ([ADR-0001](adr/0001-tou-band-boundary-model.md)).

### Gap / Overlap _(failure modes)_
**Gap**: a time slot no **TOU Band** covers (usage there has no rate). **Overlap**: a slot two bands cover (usage there is double-rated). Both must be impossible to save.

### Controlled Load (CL)
A separately-metered circuit (e.g. hot water) on its own **Register**, billed at a flat rate regardless of time, with its own **Supply Charge**. Up to two (CL1, CL2).

### Feed-in Rate
A single flat c/kWh credit applied to exported (**Generation**) energy. No TOU feed-in in V1.

### Discount
A reduction on a **Plan**, modelled as **guaranteed** (always applied) vs **conditional** (best-case only), each with its own components (default usage + supply, excluding the **Solar Credit**). Produces two **Bill** totals — guaranteed and best-case ([ADR-0007](adr/0007-discount-guaranteed-vs-conditional.md)).

---

## Usage data

### Household
The single property whose usage is being analysed. One **NMI** in scope for V1; a multi-NMI file prompts the user to pick one and never merges properties ([ADR-0010](adr/0010-multi-nmi-file-handling.md)).

### NMI (National Meter Identifier)
The unique id of the connection point. Keys the remembered **Register Mapping**.

### Register / Channel
One measured data stream in a **NEM12** file, declared by a `200` record with a Register ID / NMI Suffix (e.g. `E1`, `E3`, `B1`), a meter serial, a **UOM**, and an **Interval Length**. Distinct from the tool's **Usage Category** — a register is what the *file* provides; a category is what the *tool* uses.

### Usage Category
The tool's internal role for a register: `General`, `CL1`, `CL2`, `Generation`, or `Ignore`. Assigned by the user during **Register Mapping**. **Many registers may share a category** (kWh summed per interval); a category may also have none ([ADR-0011](adr/0011-register-mapping-cardinality.md)).

### Register Mapping
The user-confirmed assignment of each **Register** to a **Usage Category**, remembered per (NMI + Register ID) in local storage so re-imports don't re-prompt. The one-time light-touch confirmation that replaces the legacy shape-based heuristic.

### Generation
Exported energy (solar), on a `B`-suffix register. Credited via the **Feed-in Rate**. Solar export only — no forecasting, no battery modelling (hard out-of-scope).

### Interval
One usage reading covering a fixed slice of time (the **Interval Length**, e.g. 5 min) on one **Register**. The atomic unit the **TOU** engine assigns to a **TOU Band** — assignment is by the interval's whole slot, so it is robust to the labelling convention ([ADR-0001](adr/0001-tou-band-boundary-model.md)).
**Resolved** ([ADR-0016](adr/0016-nem12-interval-labelling.md)): confirmed empirically against the supplied `QB04603893_...` file — `values[0]` is the midnight-starting slot `[00:00, 00:05)`, not an off-by-one from the prior day.

### Interval Length
Minutes per **Interval**, declared per-register in the `200` record (5/15/30 in practice). N intervals per day = 1440 ÷ length.

### UOM (Unit of Measure)
The unit of interval values, declared in the `200` record (`kWh` in the sample). Energy units accepted (`Wh`/`MWh` converted to kWh); power/demand units (`kW`, `kVA`…) and unknowns are rejected with a clear error ([ADR-0012](adr/0012-uom-handling.md)).

### Quality Flag
Per-interval provenance: `A` actual, `S` substituted, `F` final substitute, `N` null, etc. Substituted values are summed as-is; **null is treated as 0 kWh**; any non-actual read in the selected period raises a visible warning ([ADR-0003](adr/0003-quality-flag-handling.md)). Carried through parsing (incl. `400`-record overrides) so the warning is date-range-aware.

### NEM12
The AEMO-mandated Meter Data File Format. **Primary** import format: registers are self-labelled, so no shape-guessing. Record types: `100` header, `200` register header, `300` daily interval row, `400` sub-day quality override, `900` footer.

### Legacy CSV _(fallback)_
The retailer-specific 30-min export with two *unlabelled* consumption streams. **Deferred to post-V1** ([ADR-0015](adr/0015-v1-scope-and-sequencing.md)) — if ever built, requires the shape-based heuristic + mandatory user confirmation to classify channels.

---

## Calculation

### Billing Period
The date range a **Bill** is computed over: custom range, "last quarter" (most recent 3 *full* calendar months, partial trailing month dropped — [ADR-0009](adr/0009-last-quarter-definition.md)), or "annual". Bounded by the range present in the imported data.

### Days in Period
The count that multiplies the **Supply Charge**: **calendar days in the selected range, inclusive of both endpoints** (`end − start + 1`); null/zero/estimated days still count ([ADR-0005](adr/0005-days-in-period.md)).

### Extrapolation
The normalisation "annual" applies so it is always a true 365-day figure regardless of the loaded span (which is **provider-dependent** — weeks to ~2 years). If ≥ 365 days exist, use the **most recent 365 days** (never sum a multi-year span raw); if < 365, scale **each TOU band's kWh and the supply day-count** by `365/days_available` (preserving usage shape), labelled an *estimate* with a **seasonal-bias** warning ([ADR-0006](adr/0006-annual-extrapolation.md)).

### Bill
The computed result for one **Plan** over one **Billing Period**: `Supply + Usage + Controlled Load − Solar Credit`, then **Discount** applied. All rates GST-inclusive. Components computed at full precision; **only the final total is rounded** to the cent, and a **net-credit total may be negative** ([ADR-0004](adr/0004-rounding-and-bill-sign.md)).

### Solar Credit
`Generation kWh × Feed-in Rate`, subtracted from the **Bill**.

### Calibration Check
A sanity test: run one real **Bill** (manually entered totals) through the flat-rate engine and show calculated vs actual $ and % variance, to prove the arithmetic before trusting interval-based **Comparisons**.

### Comparison
The ranked table of all **Plans**' **Bills** for one **Billing Period**, with per-component breakdown, the cheapest highlighted, and a usage-shape chart showing *why* — the tool's differentiator.

---

## Out of scope (V1) — named so they stay named

Gas / dual-fuel · 100% GreenPower modelling · seasonal (date-ranged) TOU · multi-property / multi-user · solar/battery forecasting · retailer web scraping. CDR API import is **Phase 2** (see PRD §9), not V1.
