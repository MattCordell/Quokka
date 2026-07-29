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

## Amendment 2 (2026-07-28) — round-2 review

Round-2 review of the amendment above found two further defects, both money-visible, in the
per-day-of-week mechanism it introduced:

1. **Flat and TOU bills stopped being on the same basis.** `scaleCategoryUsage` scales General's
   category total by `365 / daysWithData.General`, while the per-day-of-week weekly-profile scaler
   used `(365/7) / daysByDow[day]` — a *constant* fractional expectation applied to every day of
   the week alike. When day-of-week coverage is uneven (any sample that isn't an exact multiple of
   7 days — the common case), these two factors diverge, and a TOU bill priced from the weekly
   profile ends up on a different basis than a flat bill priced from the category total, for the
   *same* period. In the golden fixture (2 days: one Tuesday, one Wednesday) this **inverted the
   ranking**: the TOU plan appeared cheapest at $1509.54 vs the flat plan's $3631.75, when the
   correctly-scaled TOU figure ($1516.50, see point 2) is still nowhere near representative — only
   2 of 7 days of the week were ever sampled, so 5/7 of the year's TOU bands are unpriced zeros.
2. **A gapless 365-day sample was no longer a true no-op for TOU.** `365 / 7 = 52.142857...` is not
   an achievable day-of-week count: a real calendar year is 52 weeks + 1 day, so exactly one
   day-of-week occurs 53 times and the other six occur 52 times, never a fraction. Scaling every
   day-of-week's slice against the same fractional constant silently inflated six of the seven
   days by ~0.23% even when every single day of the year had a real reading — the "happy path" of
   a full year of clean data, `extrapolation: null`, telling every consumer it was a measured bill
   when it wasn't quite.

Both share one root cause: **the "expected" denominator for a day-of-week must come from the real
calendar, not a constant.** `expectedDaysByDow` now computes, for the most recent 365-day
reference window ending on the period's own end date, exactly how many times each day-of-week
truly occurs in it (six days at 52, one at 53) — regardless of how short the *actual* sampled
period is, since a 2-day sample still needs to know a real year's split to project against, not
its own 2-day span. `scaleGeneralWeek` now takes that as an explicit parameter instead of deriving
it from a constant. This fixes point 2 outright (a gapless real 365-day sample now scores factor 1
on every day, matching `describeExtrapolation`'s own `null`).

It does not, and cannot, fix point 1: a flat bill and a TOU bill are fundamentally different
projections whenever day-of-week coverage is uneven, because one scales a single category total
and the other scales seven independent day-of-week slices. No unifying factor exists that is
simultaneously correct for both. The `Consequences` section below is amended to exclude TOU plans
from the ranked comparison whenever this divergence is unavoidable (any day-of-week entirely
unsampled), rather than let a bill on a different basis rank against one it isn't comparable to.

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
  days on that specific day of the week with a General reading in the window, and
  `expectedByDow[day]` be how many times that day-of-week actually occurs in the most recent
  365-day calendar year ending on the window's own end date (`expectedDaysByDow`) — six days at 52
  occurrences and one at 53, **never** the fractional average `365/7`, so a genuinely gapless
  sample scores every day at factor 1. If `daysByDow[day] >= expectedByDow[day]`, that day-of-week
  is left as-is. Otherwise scale its slice of the weekly profile by
  `expectedByDow[day] / daysByDow[day]`. A day of the week with **zero** samples has no scaling
  factor that can manufacture it — its slots stay absent (contributing $0 to any TOU band
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
  that's a data-coverage limit, not a math one. **The comparison UI (Compare.svelte) excludes every
  TOU plan from the ranked list whenever this happens**, rather than surface the gap as a warning
  alongside an understated number ranked against flat plans on a different basis (round-2
  amendment): a flat bill scales one category total, a TOU bill scales seven independent
  day-of-week slices, and when coverage is uneven across those slices the two are not on
  comparable footing, no matter how clearly the shortfall is disclosed. The `Bill.extrapolation`
  descriptor itself only ever reports the flat/category-level factor for this reason — it is not,
  and must not be read as, the factor actually applied to a TOU bill's `bands`.
- A gapless, genuinely complete 365-day sample scores factor 1 on every day-of-week (not the
  ~1.0027 a constant `365/7` denominator would give six of the seven days), matching
  `describeExtrapolation`'s own `null` — the happy-path "clean full year" case is a true no-op for
  both flat and TOU bills alike.
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
