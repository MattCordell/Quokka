# ADR 0006: Annual extrapolation scales per-TOU-band kWh and the day-count, and flags seasonal bias

- **Status:** Accepted (amended 2026-07-28)
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Amendment (2026-07-28)

Code review on the implementation found the original "scale each TOU band's summed kWh by
factor" decision under-specified: a single blanket factor (`ANNUAL_DAYS / days_available`)
applied uniformly mis-weights any sample that isn't an exact multiple of 7 days, and — for a
sample shorter than a week — projects exactly **zero** kWh onto every TOU band scheduled on a
day of the week absent from the sample (e.g. a 2-day weekday-only sample zeroing every weekend
band), which silently mis-ranks a plan whose selling point is a cheap day the sample never saw.
The same blanket-factor flaw applied to category totals: a fully-covered register (e.g. solar
Generation reading every day) could mask a gap in a different mapped category (e.g. a General
meter swap) sharing the same period, since "extrapolated" was decided from calendar span alone
rather than actual data coverage.

The Decision below is corrected accordingly: scaling is now computed **per Usage Category** and
**per day-of-week**, from each dimension's own actual coverage, not one number applied
everywhere. The original goal — preserve usage shape so TOU-vs-flat ranking stays meaningful — is
unchanged; only the mechanism is corrected to actually deliver it, including for samples the
original wording didn't consider (partial weeks, and long spans with an internal gap).

## Context

The "annual" **Billing Period** (§7.3) sums actuals when ≥ 365 days exist, else extrapolates. A naive "scale the total kWh" approach loses the **TOU** usage shape, which would mis-rank TOU-vs-flat plans — the whole point of the tool. (The supplied sample has 398 days, so this only affects shorter datasets.)

The available interval history is **provider-dependent and variable** — a user may hold anything from a few weeks to ~2 years (Origin supports ~2 years; other retailers differ). "Annual" must therefore normalise to a true 365-day figure in **both** directions, never a raw sum of whatever span happens to be loaded.

## Decision

"Annual" always yields a normalised 365-day figure. The **candidate window** is resolved from the
calendar span alone: the most recent 365 calendar days in the data, or the whole span if it's
shorter. Everything past that — whether to scale, and by how much — is decided from **actual data
coverage within that window**, per dimension, not from the calendar span and not from one blanket
factor:

- **Per Usage Category** (General, CL1, CL2, Generation): let `daysWithData[category]` be the
  count of distinct days in the window with any reading on that category's mapped registers
  (regardless of quality flag). If `daysWithData[category] >= 365`, that category is summed as-is
  — no scaling, because it's already fully measured (this is what makes the `>= 365`-calendar-day
  case a no-op when the window has no internal gaps, and correctly *still scales* a category with
  an internal gap even inside a nominally-"full" 365-day window). Otherwise scale that category's
  kWh by `365 / daysWithData[category]`. Each category gets **its own** factor — a fully-covered
  Generation register must never inherit General's gap, or vice versa.
- **Per day-of-week**, for the TOU weekly profile: let `daysByDow[day]` be the count of distinct
  days on that specific day of the week with a General reading in the window. If
  `daysByDow[day] >= 365/7`, that day-of-week is left as-is. Otherwise scale its slice of the
  weekly profile by `(365/7) / daysByDow[day]`. A day of the week with **zero** samples has no
  scaling factor that can manufacture it — its slots stay absent (contributing $0 to any TOU band
  scheduled on it), and this must be disclosed explicitly rather than presented as a measured
  zero.
- **Scale the supply-charge day-count to 365** regardless of any of the above.
- **Label the result an *extrapolated estimate*** whenever General's own factor isn't 1, and
  **warn it may be seasonally biased** (e.g. a winter-only sample over-weights heating). General
  is the headline category for this label (priced on every plan, usually dominant); the
  per-category mechanism above still corrects every other mapped category independently of
  whether General needed scaling.

The supplied sample is exactly 365 days with no internal gaps, so every category's factor is 1 and
it uses the most-recent-365 path with no extrapolation.

## Consequences

- TOU shape is preserved through extrapolation for any sample with at least one reading on every
  day of the week; rankings stay meaningful in that case regardless of how unevenly those days
  happen to be represented in the sample.
- A sample missing one or more days of the week entirely cannot be shape-corrected by scaling —
  that's a data-coverage limit, not a math one — so it must be surfaced as an explicit warning
  rather than silently read as a genuine $0 for whatever TOU band falls on the unsampled day(s).
- The seasonal-bias warning sets honest expectations; we are not claiming a partial-year sample is
  a true annual figure.
- A >= 365-calendar-day window is no longer assumed complete: an interior gap inside it still
  triggers per-category scaling and the estimate label, because "extrapolated" is now a coverage
  question, not a calendar-span one.
- Extrapolation is a presentation mode over the same per-category/per-band aggregation the engine
  already produces — no separate code path for the numbers, only the scaling factors and labels.
  The `Bill` produced under extrapolation carries that fact itself (`extrapolation: {factor,
  sampledDays} | null`), so a consumer outside the Compare screen can't mistake a projected figure
  for a measured one.

## Alternatives considered

- **Scale total kWh only.** Collapses to this approach once bands are priced, unless band proportions are ignored — which mis-ranks TOU. Rejected.
- **Disable annual unless ≥ 365 days.** Removes guesswork but also removes a useful view for shorter datasets; the estimate + bias warning is a better tradeoff. Rejected.
