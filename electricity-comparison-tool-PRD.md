# PRD: QLD Electricity Plan Comparison Tool

**Status:** Draft for developer handoff
**Author:** Prepared via workshop session, 16 July 2026
**Scope:** Personal-use tool, Queensland residential electricity market

---

## 0. Grilling decisions (2026-07-16)

This PRD was hardened in a `grill-with-docs` session. The decisions below are the **source of truth** where they refine or supersede the body text; full rationale lives in [docs/adr/](docs/adr/) and the domain model in [docs/glossary.md](docs/glossary.md). Tickets should be generated against these.

| ADR | Decision | Refines |
|---|---|---|
| [0001](docs/adr/0001-tou-band-boundary-model.md) | TOU bands are half-open `[start, end)` with boundaries aligned to the register interval length; an interval belongs to the one band containing its slot; coverage validated on interval-length slots | §5.1, §7.4 |
| [0002](docs/adr/0002-controlled-load-charges-require-circuit.md) | CL supply **and** usage charges apply only if a register is mapped to that CL circuit | §5.1, §7.4 |
| [0003](docs/adr/0003-quality-flag-handling.md) | Sum values as-is (incl. substituted); null = 0 kWh; warn if the period has any non-actual read | §5.3, §7.3 |
| [0004](docs/adr/0004-rounding-and-bill-sign.md) | Round only the final total; allow negative (net-credit) totals *(noted tension with calibration accuracy)* | §7.4, §7.5 |
| [0005](docs/adr/0005-days-in-period.md) | Days-in-period = calendar days in range, inclusive of both ends; null/estimated days still counted | §7.3, §7.4 |
| [0006](docs/adr/0006-annual-extrapolation.md) | Annual extrapolation scales per-TOU-band kWh + day-count by `365/days`, flags seasonal bias | §7.3 |
| [0007](docs/adr/0007-discount-guaranteed-vs-conditional.md) | Discounts model **guaranteed vs conditional**; every bill shows two totals *(supersedes flat-% in §7.4)* | §5.1, §7.4, §7.6 |
| [0008](docs/adr/0008-usage-persistence.md) | Persist parsed usage in local storage by NMI; provide a "clear my usage" control | §7.1, §8 |
| [0009](docs/adr/0009-last-quarter-definition.md) | "Last quarter" = most recent 3 **full** calendar months; partial trailing month dropped | §7.3 |
| [0010](docs/adr/0010-multi-nmi-file-handling.md) | Multi-NMI file → prompt user to pick one NMI; never merge properties | §3, §6 |
| [0011](docs/adr/0011-register-mapping-cardinality.md) | Many registers may map to one category (kWh summed); a category may have none | §6 |
| [0012](docs/adr/0012-uom-handling.md) | Accept energy UOMs (convert Wh/MWh→kWh); reject power/demand units | §5.3 |
| [0013](docs/adr/0013-tech-stack.md) | Stack: **TypeScript + Vite + Svelte**, static-built for GitHub Pages | §8 |
| [0014](docs/adr/0014-charting-layerchart.md) | Charting: **LayerChart** (Svelte-native), bundled locally, no CDN | §7.6, §8 |
| [0015](docs/adr/0015-v1-scope-and-sequencing.md) | Walking skeleton = import→map→flat-plan→total; **legacy CSV & CDR deferred**; calc engine standalone + golden calibration test | §5.4, §6, §9, §11 |

**Still open (one item):** NEM12 interval **labelling** (interval-ending vs interval-beginning) is a fact about the data, to be confirmed empirically against the supplied file inside the parser ticket — it shifts the whole series by one slot if assumed wrong.

---

## 1. Problem statement

Existing electricity comparison tools (including Energy Made Easy) estimate cost using coarse usage bands and don't account for a household's actual half-hourly usage shape. A household with negligible night-time usage will be under-served by a comparison that treats all kWh as interchangeable — a heavily discounted daytime Time-of-Use (TOU) plan might be dramatically cheaper for them, but a flat-rate comparison won't surface that.

This tool takes a household's actual interval usage data and calculates, precisely, what the bill *would have been* under any number of manually-entered provider plans — including proper TOU rate calculation using real timestamped usage, not estimates.

## 2. Goals

- Let the user define multiple electricity plans (flat-rate and TOU) with full tariff structure.
- Let the user calculate an estimated bill for any plan using either:
  - a single manually-entered set of real bill figures, or
  - a year of interval data (NEM12 import, 5/15/30-minute resolution depending on the meter — or legacy CSV as a fallback), summed over a selected period.
- Support quarterly and annual comparison periods, with pro-rata scaling if less than 365 days of data is available.
- Correctly calculate TOU bills using actual interval timestamps against each plan's defined time bands — not averages.
- Show *why* one plan wins for this household (e.g. usage-by-TOU-band breakdown) rather than just a dollar total.
- Run entirely client-side (privacy: usage data never leaves the browser) so it can be hosted as a static site (GitHub Pages) or served from a low-cost droplet with no backend.

## 3. Non-goals (V1)

- No support for gas, dual-fuel, or 100% GreenPower cost modelling.
- No seasonal (date-ranged) TOU variation (not currently used by QLD retailers — day-of-week variation is in scope from V1, see §5.1). Revisit only if a retailer introduces seasonal TOU.
- No multi-property or multi-user accounts. Single household, single browser, local storage only.
- No automated scraping of Energy Made Easy or retailer websites (see §9 for the CDR API alternative instead).
- No solar export forecasting or battery modelling of any kind. This is explicitly out of scope, not a future enhancement — the tool only ever applies the feed-in rate to actual recorded export (§7.4). Raise as a new request if ever needed; it is not on this project's roadmap.

## 4. Users

Single user (household account holder) comparing plans for their own residence, using their own smart meter export.

## 5. Data inputs

### 5.1 Provider plan (manually entered)

Each plan is a saved record with:

| Field | Type | Notes |
|---|---|---|
| Plan name / retailer | text | free text, user-defined |
| Plan type | enum | `flat_rate` or `time_of_use` |
| General Daily Supply Charge | c/day | |
| Controlled Load 1 Daily Supply Charge | c/day | optional, 0 if not applicable |
| Controlled Load 2 Daily Supply Charge | c/day | optional, 0 if not applicable |
| **If flat_rate:** General Usage Rate | c/kWh | single rate |
| **If time_of_use:** TOU bands | array | see below |
| Controlled Load 1 Usage Rate | c/kWh | optional |
| Controlled Load 2 Usage Rate | c/kWh | optional |
| Solar Feed-in Rate | c/kWh | single flat rate (no TOU feed-in in V1) |
| Conditional discount | % | optional; applied per §7.4 |

**TOU band** (repeatable — plans must define enough bands to cover all 168 hours of the week, not just 24 hours assumed constant across days):
```
{ label: "Peak", start_time: "16:00", end_time: "20:59", rate_c_per_kwh: 44.86, days: ["MON","TUE","WED","THU","FRI"] }
{ label: "Peak (weekend)", start_time: "17:00", end_time: "19:59", rate_c_per_kwh: 38.00, days: ["SAT","SUN"] }
```
- `days` is an explicit array of day-of-week codes (`MON`...`SUN`), not a `weekday`/`weekend` shorthand — this is a deliberate V1 requirement (raised by the user, 16 Jul 2026) because some published plans do use different peak windows or rates on weekends, and modelling it as a day-list from the start avoids a schema change later. This also matches how the CDR Energy API represents `timeOfUse` bands (`days: [...]`, `startTime`, `endTime`), which keeps a future CDR-imported plan (§9) a direct fit for this schema without translation.
> **Refined ([ADR-0001](docs/adr/0001-tou-band-boundary-model.md)):** `end_time` is the **exclusive** boundary, so the example's `20:59` becomes `21:00` (`[16:00, 21:00)`). Band boundaries must align to the register's interval length. Coverage is validated on interval-length slots, not just whole hours.

- **Validation requirement:** the plan editor must check that every interval-length slot of every day-of-week is covered by exactly one band — no gaps (slots with no rate) and no overlaps (slots covered by two bands) — before the plan can be saved. Surface a clear error naming the uncovered/overlapping slots if the check fails.
- No seasonal (date-range-based) variation in V1 — see §3 and §10. The schema intentionally doesn't preclude adding a `season` field later, since CDR plans do model seasonal tariff periods (§9), but it isn't required by any QLD retailer today.

The combined **Daily Supply Charge** used in calculations is the sum of General + CL1 + CL2 daily supply charges, per the user's original requirement.

### 5.2 Household usage — single bill (manual entry)

For validating the calculation engine against a real invoice:
- Billing period start/end date
- Total General Usage (kWh)
- Total Controlled Load 1 usage (kWh) — optional
- Total Controlled Load 2 usage (kWh) — optional
- Total Solar Feed-in (kWh)
- Actual dollar total from the real bill (for calibration comparison, §7.5)

This mode only supports flat-rate calculation (no timestamps available), which is expected — it's a sanity check, not the main analysis path.

### 5.3 Household usage — interval data (NEM12 import — primary format)

**Superseded during this workshop session.** The original plan was to parse a retailer-specific export with two unlabelled Consumption streams (§6 below explains why, kept for context). The user has since supplied their actual NEM12 file — the AEMO-mandated Meter Data File Format that every NEM retailer/distributor must provide on request under Power of Choice (confirmed against AEMO's MDFF Specification NEM12/NEM13 and the retailer's own "Quick Reference Guide — Meter Data Extract"). This is a genuine standard, not retailer-specific, so it should be the tool's **primary and preferred import format** — it solves the channel-identification problem outright and will work with any QLD/NEM retailer's export, not just Origin's.

**Format summary** (from the supplied file, `QB04603893_..._ORIGIN_DETAILED.csv`, 1189 rows):

| Record type | Purpose | Count in sample |
|---|---|---|
| `100` | File header: format version, creation datetime | 1 |
| `200` | Register header: declares NMI, Register ID, NMI Suffix, meter serial, UOM, interval length (minutes) | 1 per register — 3 in sample |
| `300` | One row per day: date + N interval values for that register (N = 1440 ÷ interval length) | 1095 (3 registers × 365 days) |
| `400` | Optional: flags a sub-day range of intervals with a different quality/reason code than the day's default | 89 |
| `900` | File footer | 1 |

Example `200` records from the sample file:
```
200,QB04603893,B1E1E3,B1,B1,,LG162255430,kWh,5,
200,QB04603893,B1E1E3,E1,E1,,LG162255430,kWh,5,
200,QB04603893,B1E1E3,E3,E3,,LG12D173225,kWh,5,
```
This tells the parser everything it needs, explicitly: three registers, **5-minute intervals** (not 30 — confirmed by counting 288 values per `300` row), and which meter serial each register belongs to. Cross-checked against the retailer's own "Interval Meter Summary" PDF for this account: the `LG12D173225` meter reports only under "Controlled Load" and the `LG162255430` meter reports under "General Supply" and "Generation" — so for this file, Register `E3` = Controlled Load, `E1` = General Supply (import), `B1` = Generation (solar export). This matches the common NEM12 convention (E-suffixes = consumption/import, B-suffixes = bidirectional/export) but **the mapping is not universal across all NMIs** — see §6.

Each `300` row carries a **day-level** quality flag. **Verified against this file:** the values are `A` (actual — 1070 days) and `V` (variable — 25 days). `V` means the day has *mixed* quality and the per-interval detail is in that day's `400` records, which take the form `400,startInterval,endInterval,qualityMethod,reasonCode,` — e.g. `400,153,158,F19,79,` = intervals 153–158 are `F` (final substitute = estimated), method 19, reason 79 (89 such rows in the file). There are no `S` or `N` flags in this file, though the spec permits them. The parser must resolve per-interval quality (expand `V` days via their `400` ranges) so the UI can warn when a comparison period includes non-actual reads ([ADR-0003](docs/adr/0003-quality-flag-handling.md)).

### 5.4 Household usage — interval data (legacy CSV — secondary/fallback format)

The originally-supplied file (`A-56645A77-..._ELECTRICITY-16-07-2026.csv`, 30-minute intervals, two unlabelled Consumption rows plus a Feed In row per interval) covers the same property and an overlapping date range. Keep support for it as a **fallback path** for retailers that don't offer a clean NEM12 export on request, but it should not be the primary design target — see §6 for why NEM12 is the better input whenever it's available.

## 6. Controlled Load channel identification — resolved by switching to NEM12

**Original problem:** the legacy CSV (§5.4) has two unlabelled Consumption streams with no column header distinguishing General Usage from Controlled Load, which would have required a shape-based heuristic (guess from daytime-zero pattern) with a user confirmation step to de-risk it.

**Better resolution, now that NEM12 is available (per user, 16 Jul 2026):** NEM12's `200` records explicitly declare a Register ID and NMI Suffix per data stream, so there's no need to guess from usage shape at all — the registers are labelled by the file itself. The remaining design task is simpler: **map each NMI's set of registers to the tool's internal categories (General Usage, Controlled Load 1, Controlled Load 2, Generation) once per import, and let the user confirm it**, because:
- The specific letter/number code (`E1`, `E3`, `B1`, etc.) is standard-ish but not contractually fixed to a meaning for every NMI — the authoritative source of truth is the meter serial's actual purpose, which the user can see on their retailer's Interval Meter Summary (as supplied) or knows from their own installation (e.g. "the hot water is on the second meter").
- On import, show each register's ID, meter serial, and a sample daily-usage shape chart, and let the user assign each one to General / CL1 / CL2 / Generation / Ignore. Remember the mapping (keyed by NMI + register ID) in local storage so re-importing an updated extract from the same property doesn't require re-confirming.
- If the legacy CSV path (§5.4) is ever used, fall back to the original shape-based heuristic with mandatory user confirmation, exactly as previously scoped — but this is now the fallback, not the primary path.

This is a strictly better outcome than the original heuristic-only design: the classification is grounded in a file-declared label rather than an inferred pattern, with the user confirmation step now a one-time light-touch check rather than the load-bearing assumption it would have been for the legacy CSV.

## 7. Functional requirements

### 7.1 Plan management
- Create, edit, duplicate, delete provider plans.
- Persisted in browser local storage (no backend, no login).
- Import/export a plan (or full plan library) as JSON, so plans can be backed up or shared between devices manually.

### 7.2 Usage data
- CSV upload for interval data, with the import review/confirmation step from §6.
- Manual single-bill entry form (§5.2) for calibration.
- Date-range picker constrained to the range actually present in the imported data.

### 7.3 Billing period selection
- Custom date range (bounded by available data).
- "Last quarter" (most recent 3 full calendar months in the dataset).
- "Annual": normalise to a true 365-day figure in **both** directions ([ADR-0006](docs/adr/0006-annual-extrapolation.md)) — if ≥365 days of data exist, use the **most recent 365 days** and sum actuals (never sum a multi-year span raw); if fewer than 365 days, scale per-TOU-band kWh + supply day-count to 365 and label it an *extrapolated estimate* with a seasonal-bias warning. **Available history is provider-dependent** (verified: the supplied NEM12 file is exactly 365 days, 2025-07-01 → 2026-06-30, because that span was requested; Origin supports ~2 years, other retailers vary), so the tool must handle anything from weeks to ~2 years. *(The "398 days" cited in earlier drafts was the legacy CSV's span — 19,104 half-hour intervals — not this NEM12 file's.)*

### 7.4 Bill calculation engine

For a given plan + date range + usage data, compute:

- **Daily supply charge:** `(General + CL1 + CL2 daily supply charges) × number of days in period`
- **General usage cost:**
  - Flat rate: `total general kWh × general rate`
  - TOU: for every interval in range, assign to a TOU band by its local start time and day-of-week (matching against the band's `days` array), sum kWh per band, then `Σ(band kWh × band rate)`
- **Controlled load cost:** `CL1 kWh × CL1 rate + CL2 kWh × CL2 rate` (flat rate only, per current QLD market offers)
- **Solar credit:** `total feed-in kWh × feed-in rate` (subtracted from total)
- **Discount** — > **Refined ([ADR-0007](docs/adr/0007-discount-guaranteed-vs-conditional.md)):** discounts are modelled as **guaranteed** (always applied) vs **conditional** (e.g. pay-on-time), each with its own components; every bill yields two totals (*guaranteed* and *best-case*). Each discount is applied as `% off` its chosen components (usage only, or usage + supply charge), since retailers vary; default is usage + supply charge, excluding the solar credit, and this default must be visible/editable per discount.
- **Total = Supply charge + General usage + Controlled load − Solar credit, less discount.**

All rates are assumed to be entered as GST-inclusive c/kWh or c/day, matching how they appear on an actual bill and on Energy Made Easy — the tool does not add GST separately. State this assumption once in the UI (e.g. an info tooltip) so it isn't ambiguous to the user later.

### 7.5 Calibration check
- When a single real bill (§5.2) is entered, run it through the flat-rate calculation for that same plan and show calculated vs actual, with the difference and % variance.
- Purpose: let the user confirm the engine's arithmetic matches their real invoice before trusting the interval-data-based comparisons across other plans.

### 7.6 Comparison view
- Table of all saved plans ranked by total estimated cost for the selected period, with a breakdown column per charge component (supply, general usage, controlled load, solar credit, discount).
- Highlight the cheapest plan.
- A usage-shape chart (kWh by hour-of-day, or % of general usage falling into each TOU band as currently defined by the plans in the library) so the user can see *why* a TOU plan does or doesn't suit their pattern — this is the tool's key differentiator from generic comparison sites.

## 8. Non-functional requirements

- **Hosting:** V1 is static files only (HTML/CSS/JS), deployable to GitHub Pages or as static content on a Digital Ocean droplet — no server-side logic, no database. Phase 2 CDR integration (§9) may add a scheduled batch job (9.1) and/or a small stateless proxy function (9.2, only if needed for CORS) — neither is a persistent backend or database, so the low-cost/low-infra goal holds, but it's worth flagging now rather than discovering it late: V1's "purely static, zero infrastructure" claim doesn't extend unchanged into Phase 2.
- **Privacy:** all usage data processing happens in-browser; the CSV never leaves the device.
- **Performance:** NEM12's per-day-per-register row format is actually more compact than the legacy CSV — the supplied one-year, three-register, 5-minute-interval file is only ~1,200 rows (vs 57,000+ for the equivalent 30-minute legacy CSV export), so parsing performance is a smaller concern for NEM12. Still avoid blocking the UI thread on parse/aggregation for either format; use a streaming or chunked approach if profiling shows it's needed.
- **Data persistence:** browser local storage for plans; note explicitly to the user that clearing browser data will lose saved plans, and that plans live per-device, not synced.

## 9. Phase 2: CDR API integration for plan data (detailed design, not built in V1)

V1 ships with manual plan entry only (§5.1, §7.1). This section specs out the CDR integration properly, per the user's request, so it's ready to build later without redesigning the data model. Two independent approaches are viable, and they solve different problems.

### 9.1 Approach A — scheduled batch refresh + "best plan for me" across the whole market

**The question this answers:** *"If we pull data for all providers periodically, can we identify the best plan for the user without a live backend?"* Yes — but the compute has to happen somewhere periodically, just not on every page load or per-user request.

**Why a live backend isn't the right shape for this:** a full QLD residential electricity market crawl is a lot of calls. From this session's research: a single large retailer can have 1,000+ plans nationally; filtering to one distributor + electricity + residential + market-offer-only cut one retailer's list from 1,368 to 84 in a real-world example someone documented. Across QLD's ~10+ retailers, a filtered crawl is plausibly several hundred to ~2,000 plans, and the API is a **two-step process per retailer**: `Get Generic Plans` (paginated, max 1,000 records per call, 25 by default) to list plan IDs, then one `Get Generic Plan Detail` call **per individual plan ID** to get the actual tariff structure. That's not something to run synchronously while a user waits.

**Recommended shape:** a **scheduled batch job**, not a persistent server:
1. A cron-triggered script (e.g. a GitHub Actions scheduled workflow — free for this volume, keeps the "low-cost" goal intact) runs weekly (or less often — plan data doesn't change daily).
2. It reads the AER's published list of retailer CDR base URIs (a maintained lookup table in the repo, refreshed occasionally — see 9.3), calls `Get Generic Plans` for each QLD-relevant retailer, filters to electricity/residential/market-offer/current, then calls `Get Generic Plan Detail` for each resulting plan ID.
3. Each plan is normalised into this tool's internal plan schema (§5.1) — including the GST adjustment in §9.3 — and the whole set is written out as one static JSON snapshot file (e.g. `qld-plans-snapshot.json`) with a generation timestamp.
4. That snapshot is committed/published alongside the static site. The **client-side app loads the snapshot and runs the existing bill-calculation engine (§7.4) against it entirely in the browser**, using the household's own interval data — no server-side compute happens at request time, only at (weekly) publish time.
5. This preserves the static-hosting goal (§8) almost entirely — the only addition is a scheduled job that runs independently of the live site and produces a file. It does not require a database or a running server process.

**Practical caveats to design around:**
- CDR rate limits apply (per the Consumer Data Standards' Non-Functional Requirements) but the exact figures weren't confirmed in this session — treat "how many calls per minute the batch job can safely make" as a spike to run early in Phase 2 implementation, and add throttling/backoff accordingly.
- The AER has previously restricted `Get Generic Plans` to per-retailer queries only (no whole-of-market single call) — confirmed current as of this session — so the crawl must iterate retailers one at a time.

### 9.2 Approach B — on-demand single-plan import (no batch job required)

**The question this answers:** *"If we can't/don't want to do the batch approach, can the user just pick a plan themselves and have the tool fetch its details?"* Yes, and this is the simpler feature to build first — it needs no scheduled job and (probably) no backend at all.

Two entry points, both ending at the same `Get Generic Plan Detail` call:

- **Paste an Energy Made Easy link.** The plan ID is already sitting in the URL as the `id` query parameter (e.g. `.../plan?id=KOG1060599MRE1&postcode=...`) — the app just needs a regex to pull it out. Plan IDs appear to be prefixed with a retailer brand code (`KOG`, `RED`, `AGL`, etc. observed in this session's research), which can be matched against the AER's retailer code list (9.3) to find the right base URI to call. If that inference ever fails, fall back to asking the user which retailer the plan belongs to via a dropdown.
- **Dropdown selection.** User picks a retailer from a maintained list (9.3), the app calls `Get Generic Plans` for that retailer live, populates a plan-name dropdown from the response, then calls `Get Generic Plan Detail` for the selected plan.

Either way, the returned JSON is mapped into the Plan Manager's fields (§5.1) and **shown to the user for review before saving** — not auto-saved silently — because:
- Real-world plan data can include structures this tool doesn't model in V1 (stepped/banded usage rates, demand charges, VPP-specific fields) — these need a visible "not imported, please check the retailer's plan documents" note rather than being silently dropped.
- The GST treatment needs correcting on import, not assumed — see 9.3.
- This mirrors the same "confirm, don't silently trust" pattern already used for NEM12 register mapping (§6) — consistent UX, and it protects against acting on a load-bearing number the user never actually saw.

**Architecture note — CORS:** the Consumer Data Standards state that Data Holders "should provide full support of Cross-Origin Resource Sharing" for the equivalent Banking product-reference endpoints; it's reasonable to expect the Energy PRD endpoints follow the same principle, but this wasn't independently confirmed for the energy API specifically in this session. **First task of Phase 2 implementation: a throwaway test call directly from a browser console against a real base URI to confirm.** If CORS is supported, Approach B needs no backend at all — everything runs client-side, consistent with §8. If it's blocked, a single small serverless proxy function (e.g. a Cloudflare Worker or Netlify Function that just forwards the request and adds CORS headers) resolves it without requiring a full backend or database — still consistent with the low-cost, low-infra goal.

### 9.3 Data mapping caveats that apply to both approaches

- **GST is not uniformly handled.** Per the Consumer Data Standards' own documentation of this exact issue: some CDR plan fields (e.g. daily supply charge, controlled load rates) are specified GST-*exclusive*, while this tool's internal model (§7.4) — and Energy Made Easy's own consumer-facing display — treats all rates as GST-*inclusive*, matching what's printed on a real bill. **Any CDR import must apply the correct GST adjustment per field before storing the value**, not assume the API response is bill-ready. This needs a field-by-field mapping table maintained against whatever the current Consumer Data Standards specify (fields and their GST treatment do get revised — check at implementation time, not against this PRD).
- **Plan structure is more expressive than this tool's V1 schema.** The CDR/EME schema supports seasonal `tariffPeriod`s (date-ranged, e.g. summer/winter bands) and stepped/banded rate structures — richer than the flat day-of-week model in §5.1. Since QLD retailers don't currently use seasonal TOU (§3, §10), this is mostly a non-issue for now, but the importer must clearly flag any plan it can't fully represent rather than silently truncating it.
- **A retailer base-URI lookup table is required either way** — the AER publishes a list of CDR base URIs per retailer (updated periodically, not real-time). This should be a small maintained JSON file in the codebase, refreshed occasionally (e.g. checked monthly by the same scheduled job infrastructure from 9.1, or manually) — not fetched fresh on every use, since it changes rarely.
- **No accreditation is required** for `Get Generic Plans` / `Get Generic Plan Detail` — both are explicitly public, unauthenticated endpoints under the CDR framework, so nothing here needs API keys or OAuth.

### 9.4 Recommendation

Build **Approach B (9.2)** first if/when Phase 2 goes ahead — it's immediately useful, needs no scheduled infrastructure, and directly replaces the tedious part of manual entry (copying numbers off a plan page) while keeping the human review step that manual entry already has implicitly. Treat **Approach A (9.1)** as a later Phase 2b: it answers a genuinely different question (market-wide "what's the best plan out there") rather than "help me enter the plan I already picked," and it's a bigger lift (scheduled job, retailer-by-retailer crawl, snapshot publishing) for a benefit that's only valuable once Approach B (and the core comparison engine) is already proven out.

## 10. Assumptions and risks

| # | Assumption/Risk | Mitigation |
|---|---|---|
| 1 | Register-to-category mapping (which NEM12 register is General/CL1/CL2/Generation) is not contractually fixed by the register code alone | User confirms the mapping once per NMI at import, guided by the register's meter serial and usage shape (§6) |
| 2 | All entered rates are GST-inclusive | Stated once in UI; no separate GST calculation |
| 3 | No seasonal (date-ranged) TOU variation exists in current QLD market, though weekday/weekend variation does and is now supported from V1 | Data model (§5.1) already supports per-band day-of-week arrays; a `season` field could be added later without breaking existing plans if a QLD retailer ever introduces seasonal TOU |
| 4 | QLD has no daylight saving, so interval timestamps have a constant UTC offset year-round | No DST handling required; would need revisiting if extended to other states |
| 5 | Discount definitions vary by retailer (some exclude supply charge, some exclude everything but usage) | Made explicit and editable per plan rather than hardcoded (§7.4) |
| 6 | Legacy CSV format (§5.4) is specific to this user's retailer export; other retailers' non-NEM12 exports may format differently | NEM12 is the primary/recommended path precisely because it avoids this risk; legacy CSV parser should validate expected columns and fail clearly rather than silently misreading an unexpected format |
| 7 | Some days in the sample data include estimated (final-substitute) reads, not actual meter reads — verified: 25 `V`-flagged days with `F19` sub-ranges in `400` records | Parser resolves per-interval quality (expands `V` days via `400` ranges); UI surfaces a note when a selected comparison period includes non-actual reads ([ADR-0003](docs/adr/0003-quality-flag-handling.md)) |
| 8 | (Phase 2 only) CDR API fields aren't uniformly GST-inclusive, unlike this tool's internal convention and EME's consumer-facing display | Field-by-field GST adjustment required on import (§9.3); must be checked against current Consumer Data Standards at implementation time, not assumed from this PRD |
| 9 | (Phase 2 only) CDR browser-side CORS support for the Energy PRD endpoints specifically wasn't independently confirmed this session (confirmed for the equivalent Banking endpoints) | Spike/test call as the first Phase 2 task (§9.2); fall back to a small stateless proxy function if blocked |
| 10 | (Phase 2 only) CDR rate limits for the batch crawl (9.1) weren't quantified this session | Treat as a spike; add throttling/backoff in the scheduled job regardless |

## 11. Suggested screens

1. **Plans** — list of saved plans, add/edit/duplicate/delete, import/export JSON.
2. **Usage data** — NEM12 (or legacy CSV) upload, register-mapping review/confirmation (§6), or manual single-bill entry (§5.2 / §7.5 calibration).
3. **Compare** — period selector, ranked results table, usage-shape chart.

## 12. Future enhancements (explicitly out of scope for V1)

- Phase 2a: on-demand single-plan import via the CDR API, by pasted EME link or retailer/plan dropdown (§9.2).
- Phase 2b: scheduled full-market batch refresh and automatic "best plan for your usage" recommendation across all QLD retailers (§9.1).
- Exportable comparison report (PDF/CSV).
- Seasonal (date-ranged) TOU band variation — not required by any current QLD retailer; the data model doesn't preclude adding it later (§10).
