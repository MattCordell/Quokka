<script lang="ts">
  import { listStoredNmis, loadUsage, loadMapping, loadPlans } from '../lib/storage/persistence';
  import {
    aggregateUsage,
    aggregateGeneralWeek,
    daysInPeriod,
    priceFlatBill,
    priceTouBill,
    compactToIso,
    CalcError,
    resolveLastQuarter,
    quarterMonthPeriods,
    resolveAnnualPeriod,
    scaleCategoryUsage,
    scaleGeneralWeek,
    describeExtrapolation,
    missingDaysOfWeek,
    expectedDaysByDow,
    ANNUAL_DAYS,
  } from '../lib/calc';
  import { USAGE_CATEGORIES } from '../lib/mapping/types';
  import { validateBandCoverage } from '../lib/plan/coverage';
  import type { FlatPlan, TouPlan, TouDay } from '../lib/plan/types';
  import { formatCents } from '../lib/format';
  import { rankPlanBills, type RankBasis, type RankedPlanBill } from '../lib/compare/rank';
  import { hourOfDayProfile } from '../lib/usage/shape';
  import NonActualReadsBadge from '../components/NonActualReadsBadge.svelte';
  import UsageShapeChart from '../components/UsageShapeChart.svelte';

  function isTouRow(row: RankedPlanBill): row is RankedPlanBill & { plan: TouPlan } {
    return row.plan.type === 'time_of_use';
  }

  const nmis = listStoredNmis();
  let selectedNmi = $state<string | null>(nmis.length === 1 ? nmis[0] : null);
  const plans = loadPlans();
  const flatPlans = plans.filter((p): p is FlatPlan => p.type === 'flat_rate');
  const touPlans = plans.filter((p): p is TouPlan => p.type === 'time_of_use');
  // The engine refuses to price a TOU plan whose Band Coverage is invalid (calc/tou.ts throws),
  // so those are excluded here rather than crashing `rows` below; invalidTouPlans is surfaced
  // as a visible warning instead of silently vanishing (they still show/edit fine on Plans).
  const priceableTouPlans = touPlans.filter((p) => validateBandCoverage(p.touBands));
  const invalidTouPlans = touPlans.filter((p) => !validateBandCoverage(p.touBands));

  let usage = $derived(selectedNmi ? loadUsage(selectedNmi) : null);
  let mapping = $derived(selectedNmi ? loadMapping(selectedNmi) : null);

  // The date inputs edit these directly (see onchange below); null means "use the full data
  // span". A plain object returned from $derived isn't deeply reactive, so mutating a nested
  // property (e.g. via bind:value={period.start}) would not trigger dependent recomputation —
  // these need to be their own $state.
  let startOverride = $state<string | null>(null);
  let endOverride = $state<string | null>(null);

  // 'custom' means "whatever startOverride/endOverride hold" (the pre-existing behaviour);
  // 'lastQuarter'/'annual' additionally drive those overrides from the resolved preset (see
  // selectPeriodMode below), so the existing clamped `period` derivation needs no change.
  let periodMode = $state<'custom' | 'lastQuarter' | 'annual'>('custom');

  let rankBasis = $state<RankBasis>('bestCase');
  let shapeView = $state<'hourOfDay' | 'band'>('hourOfDay');
  // Defaults to the best-ranked TOU plan; an explicit choice sticks as long as that plan is still
  // priceable. Read as a null sentinel inside a $derived rather than synced back via an $effect,
  // so re-ranking on a basis flip never fights the user's selection.
  let selectedTouPlanId = $state<string | null>(null);

  // Drop any manual date-range edits whenever the selected NMI's usage changes, so the period
  // defaults back to the full data span for the newly selected property.
  $effect(() => {
    void usage;
    startOverride = null;
    endOverride = null;
    periodMode = 'custom';
  });

  function clamp(value: string, min: string, max: string): string {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  // toFixed(1) alone renders any factor under 1.05 as "x1.0" — indistinguishable from "no scaling
  // happened", which reads as a bug rather than the small correction it actually is (a ~350-day
  // sample lands here routinely). Two significant figures for a small factor keeps large ones
  // (e.g. x182.5) just as readable.
  function formatFactor(factor: number): string {
    return factor.toFixed(factor < 10 ? 2 : 1);
  }

  // The full data span (unclamped by any override) that the presets below resolve against.
  let dataSpan = $derived.by(() => {
    if (!usage) return null;
    return { start: compactToIso(usage.firstDate), end: compactToIso(usage.lastDate) };
  });

  // resolveLastQuarter only checks that the quarter's calendar bounds fit inside the data span's
  // endpoints (ADR-0009) — it can't see whether the data actually has readings throughout, so a
  // file with e.g. Jan-Mar and Jul readings but nothing between could otherwise resolve a quarter
  // with an empty middle month. Checked against General specifically, not "any category has any
  // day of data": a fully-covered non-General register (e.g. solar Generation reading every day)
  // must not mask a General gap that shares the same month, the same masking CategoryUsage.
  // daysWithData is itself split per-category to prevent (calc/types.ts).
  let lastQuarterCandidate = $derived(dataSpan ? resolveLastQuarter(dataSpan) : null);
  let lastQuarterPeriod = $derived.by(() => {
    if (!lastQuarterCandidate || !usage || !mapping) return null;
    const monthsHaveData = quarterMonthPeriods(lastQuarterCandidate).every(
      (month) => aggregateUsage(usage, mapping, month).daysWithData.General > 0,
    );
    return monthsHaveData ? lastQuarterCandidate : null;
  });

  // resolveAnnualPeriod only resolves the calendar window (ADR-0006); how much of it is
  // extrapolated is decided per-category from the real aggregation below (periodAgg), not here.
  let annualCandidate = $derived(dataSpan ? resolveAnnualPeriod(dataSpan) : null);

  // Custom resets to the full span (null overrides); the two presets snap the date inputs to
  // their resolved range. Editing a date input directly (onchange below) flips back to 'custom'
  // so a partial manual edit is never misread as a preset with a stale factor.
  function selectPeriodMode(mode: 'custom' | 'lastQuarter' | 'annual') {
    periodMode = mode;
    if (mode === 'custom') {
      startOverride = null;
      endOverride = null;
    } else if (mode === 'lastQuarter' && lastQuarterPeriod) {
      startOverride = lastQuarterPeriod.start;
      endOverride = lastQuarterPeriod.end;
    } else if (mode === 'annual' && annualCandidate) {
      startOverride = annualCandidate.start;
      endOverride = annualCandidate.end;
    }
  }

  // Clamped to the actual data span regardless of what the override holds — the date inputs'
  // min/max are advisory only (a keyboard-typed out-of-range value still fires onchange), and an
  // unclamped override would inflate daysInPeriod (and so the supply charge) past what usage
  // data actually backs.
  let period = $derived.by(() => {
    if (!dataSpan) return null;
    return {
      start: clamp(startOverride ?? dataSpan.start, dataSpan.start, dataSpan.end),
      end: clamp(endOverride ?? dataSpan.end, dataSpan.start, dataSpan.end),
    };
  });

  let periodValid = $derived(!!period && period.start <= period.end);

  // Whether the annual candidate window is the period in force. Gated on the resolved candidate's
  // dates still matching `period` (not just periodMode === 'annual') so a manual date edit — which
  // flips periodMode to 'custom' but could in principle land back on the same range — can never
  // apply extrapolation to numbers it no longer describes.
  let annualActive = $derived(
    periodMode === 'annual' &&
      !!period &&
      !!annualCandidate &&
      period.start === annualCandidate.start &&
      period.end === annualCandidate.end,
  );

  // aggregateUsage/aggregateGeneralWeek depend only on usage/mapping/period, not on any plan's
  // rates, so they're hoisted here and priced per plan below rather than re-aggregated inside a
  // per-plan call — O(data + plans) instead of O(data x plans). generalWeek is computed
  // unconditionally (the hour-of-day usage-shape chart needs it even with zero TOU plans saved),
  // but aggregateGeneralWeek throws CalcError for a General register whose interval length
  // doesn't divide the 30-min TOU coverage grid (e.g. an 18-min meter) — caught here rather than
  // taking down the whole screen for a flat-only user with such a meter. Its `daysByDow` output
  // comes back alongside `week` from the same pass, not a separate re-walk of the registers.
  //
  // Annual extrapolation (ADR-0006) scales these same aggregated inputs — per category
  // (scaleCategoryUsage) and per day-of-week (scaleGeneralWeek, against expectedDaysByDow's real
  // calendar split, not a constant fraction) from their own real coverage, never one blanket
  // factor — rather than adding a second pricing path; priceFlatBill/priceTouBill below are
  // unchanged.
  let periodAgg = $derived.by(() => {
    if (!usage || !mapping || !period || !periodValid) return null;
    let generalWeek: Map<string, number>;
    let generalDaysByDow: Record<TouDay, number> | null = null;
    let generalWeekError: string | null = null;
    try {
      const result = aggregateGeneralWeek(usage, mapping, period);
      generalWeek = result.week;
      generalDaysByDow = result.daysByDow;
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      generalWeek = new Map();
      generalWeekError = e.message;
    }
    const agg = aggregateUsage(usage, mapping, period);
    const sampledDays = daysInPeriod(period);
    const extrapolation = annualActive ? describeExtrapolation(agg) : null;
    // A day-of-week with zero General samples can't be scaled into existence (scaleGeneralWeek's
    // own doc comment) — computed once here so both the scaling and the disclosure below share it.
    const expectedByDow = annualActive && generalDaysByDow ? expectedDaysByDow(period) : null;

    return {
      period,
      days: annualActive ? ANNUAL_DAYS : sampledDays,
      sampledDays,
      agg: annualActive ? scaleCategoryUsage(agg) : agg,
      generalWeek:
        generalDaysByDow && expectedByDow
          ? scaleGeneralWeek(generalWeek, generalDaysByDow, expectedByDow)
          : generalWeek,
      generalWeekError,
      extrapolation,
      missingDows:
        annualActive && generalDaysByDow ? missingDaysOfWeek(generalDaysByDow) : ([] as TouDay[]),
    };
  });

  // Per-category data-coverage shortfalls within the period in force (kept per-category, not
  // unioned, so a fully-covered register — e.g. solar Generation — can't mask a gap in a
  // different mapped category, like a General meter swap, that happens to share the period).
  let coverageGaps = $derived.by(() => {
    if (!periodAgg) return [];
    const { agg, sampledDays } = periodAgg;
    return USAGE_CATEGORIES.filter(
      (category) => agg.mappedCategories[category] && agg.daysWithData[category] < sampledDays,
    ).map((category) => ({ category, daysWithData: agg.daysWithData[category] }));
  });

  // Pricing a TOU plan against an empty generalWeek (the generalWeekError case) would silently
  // return a supply-plus-CL-only bill — a wrong number presented with full confidence, the one
  // failure mode a money tool can't have — so every TOU plan is excluded from rows, not just the
  // ones with invalid Band Coverage. The same applies when annual mode has no General data for
  // one or more days of the week (missingDows non-empty): scaleGeneralWeek can't project those
  // days from nothing, so any band scheduled on them prices at $0, dragging that TOU plan's total
  // down by an amount that has nothing to do with its rates — while every flat plan in the same
  // list is scaled off the full General category total. Ranking the two bases against each other
  // silently inverts which plan looks cheapest (round-2 review finding #1), so TOU plans are
  // excluded here too rather than shown understated; the missingDows banner below explains why.
  let rows = $derived.by(() => {
    if (!periodAgg) return [];
    const {
      period: p,
      days,
      agg,
      generalWeek,
      generalWeekError,
      extrapolation,
      missingDows,
    } = periodAgg;
    const flatRows = flatPlans.map((plan) => ({
      plan,
      bill: priceFlatBill(plan, agg, days, p, extrapolation),
    }));
    const touRows =
      generalWeekError || missingDows.length > 0
        ? []
        : priceableTouPlans.map((plan) => ({
            plan,
            bill: priceTouBill(plan, agg, generalWeek, days, p, extrapolation),
          }));
    return [...flatRows, ...touRows];
  });

  let rankedRows = $derived(rankPlanBills(rows, rankBasis));

  let cl1Applicable = $derived(periodAgg?.agg.mappedCategories.CL1 ?? false);
  let cl2Applicable = $derived(periodAgg?.agg.mappedCategories.CL2 ?? false);

  // Suppressed under the same condition as the TOU rows above (missingDows non-empty): this
  // chart's absolute kWh comes from the same per-day-of-week-scaled generalWeek a TOU plan would
  // be priced against, so it carries the identical understatement for whichever day-of-week has
  // no data — showing it here would contradict the exclusion rationale above.
  let hourOfDayData = $derived(
    periodAgg && !periodAgg.generalWeekError && periodAgg.missingDows.length === 0
      ? hourOfDayProfile(periodAgg.generalWeek).map((value, hour) => ({
          label: `${hour}:00`,
          value,
        }))
      : [],
  );

  let touRows = $derived(rankedRows.filter(isTouRow));
  let bestRankedTouId = $derived(touRows[0]?.plan.id ?? null);
  let effectiveTouPlanId = $derived(
    selectedTouPlanId && touRows.some((r) => r.plan.id === selectedTouPlanId)
      ? selectedTouPlanId
      : bestRankedTouId,
  );
  let selectedTouBands = $derived(
    touRows.find((r) => r.plan.id === effectiveTouPlanId)?.bill.bands ?? [],
  );
  let bandSharePercent = $derived.by(() => {
    const total = selectedTouBands.reduce((sum, b) => sum + b.kwh, 0);
    return selectedTouBands.map((b) => ({
      label: b.label,
      value: total > 0 ? (b.kwh / total) * 100 : 0,
    }));
  });
</script>

<section>
  <h2>Compare</h2>
  <p>All rates are GST-inclusive.</p>

  {#if nmis.length === 0}
    <p role="alert">No usage data yet — import a NEM12 file on the Usage data tab first.</p>
  {:else}
    {#if nmis.length > 1}
      <fieldset>
        <legend>Pick a property to compare</legend>
        {#each nmis as nmi (nmi)}
          <label>
            <input
              type="radio"
              name="compare-nmi"
              value={nmi}
              checked={selectedNmi === nmi}
              onchange={() => (selectedNmi = nmi)}
            />
            {nmi}
          </label>
        {/each}
      </fieldset>
    {/if}

    {#if selectedNmi}
      {#if !usage}
        <p role="alert">No usage data stored for {selectedNmi}.</p>
      {:else if !mapping}
        <p role="alert">
          Complete the Register Mapping for {selectedNmi} on the Usage data tab first.
        </p>
      {:else if flatPlans.length === 0 && touPlans.length === 0}
        <p role="alert">Create a plan on the Plans tab first.</p>
      {:else if period}
        <fieldset>
          <legend>Billing period</legend>
          <label class="inline">
            <input
              type="radio"
              name="periodMode"
              value="custom"
              checked={periodMode === 'custom'}
              onchange={() => selectPeriodMode('custom')}
            />
            Custom
          </label>
          <label class="inline">
            <input
              type="radio"
              name="periodMode"
              value="lastQuarter"
              checked={periodMode === 'lastQuarter'}
              disabled={!lastQuarterPeriod}
              onchange={() => selectPeriodMode('lastQuarter')}
            />
            Last quarter
          </label>
          <label class="inline">
            <input
              type="radio"
              name="periodMode"
              value="annual"
              checked={periodMode === 'annual'}
              onchange={() => selectPeriodMode('annual')}
            />
            Annual
          </label>
        </fieldset>
        {#if !lastQuarterPeriod}
          <p class="note">
            Last quarter needs 3 complete calendar months of data; this property doesn't have enough
            yet.
          </p>
        {/if}

        <!-- `|| null` (not just the raw value): clearing a date input via backspace fires
             onchange with '', which would otherwise bypass the ?? default above and feed an
             unparseable date into daysInPeriod. Editing either date directly always drops back to
             'custom' — a partial manual edit must never be read as a preset with a stale factor. -->
        <div class="period">
          <label>
            Start
            <input
              type="date"
              min={dataSpan?.start}
              max={dataSpan?.end}
              value={period.start}
              onchange={(e) => {
                startOverride = e.currentTarget.value || null;
                periodMode = 'custom';
              }}
            />
          </label>
          <label>
            End
            <input
              type="date"
              min={dataSpan?.start}
              max={dataSpan?.end}
              value={period.end}
              onchange={(e) => {
                endOverride = e.currentTarget.value || null;
                periodMode = 'custom';
              }}
            />
          </label>
        </div>

        {#if !periodValid}
          <p class="error" role="alert">The start date must not be after the end date.</p>
        {:else if periodAgg}
          <p class="note">
            Billing {period.start} to {period.end} ({periodAgg.days} day{periodAgg.days === 1
              ? ''
              : 's'} for the supply charge{#if periodAgg.extrapolation}, normalised from {periodAgg
                .extrapolation.sampledDays} sampled day{periodAgg.extrapolation.sampledDays === 1
                ? ''
                : 's'}{/if}).
          </p>

          <!-- These advisory paragraphs are static on render, not mid-interaction interruptions,
               so they intentionally carry no role="alert": several can appear in the same tick
               (extrapolation banner + missing-days banner + one line per gappy category), and
               stacking several assertive live regions just means a screen reader user hears
               fragments of the last one rather than each in turn. They're already visible and in
               document order, which is enough. -->
          {#if periodAgg.extrapolation}
            <p class="banner">
              <strong>Estimated annual figure.</strong> Based on {periodAgg.extrapolation
                .sampledDays}
              day{periodAgg.extrapolation.sampledDays === 1 ? '' : 's'} of General data within {period.start}
              to {period.end}, scaled x{formatFactor(periodAgg.extrapolation.factor)} to a 365-day year.
              This is an extrapolated estimate, not a measured annual bill — it may be seasonally biased
              (e.g. a winter-only sample over-weights heating), or understated if the shortfall reflects
              a data gap rather than a genuinely short history.
            </p>
          {/if}

          {#if periodAgg.missingDows.length > 0}
            <p class="banner">
              <strong>Time-of-use plans excluded from this estimate.</strong> No General data for {periodAgg.missingDows.join(
                ', ',
              )} in the sampled period — projecting a time-of-use bill would price every band scheduled
              on {periodAgg.missingDows.length === 1 ? 'that day' : 'those days'} at $0, understating
              it against the flat-rate plans in the same list. Switch to Custom or Last quarter to see
              time-of-use pricing for this property, or import data covering every day of the week.
            </p>
          {/if}

          {#each coverageGaps as gap (gap.category)}
            <p class="banner">
              {gap.category}: {periodAgg.sampledDays - gap.daysWithData} of {periodAgg.sampledDays} days
              in this period have no data —
              {#if periodAgg.extrapolation}
                the annual estimate projects from the remaining {gap.daysWithData} day{gap.daysWithData ===
                1
                  ? ''
                  : 's'}, so it assumes the missing days resemble them.
              {:else}
                totals are understated by that shortfall.
              {/if}
            </p>
          {/each}

          <NonActualReadsBadge days={periodAgg.agg.nonActualDayCount} />

          {#if invalidTouPlans.length > 0}
            <p role="alert">
              {invalidTouPlans.length} time-of-use plan{invalidTouPlans.length === 1 ? '' : 's'}
              {invalidTouPlans.length === 1 ? "isn't" : "aren't"} shown here — Band Coverage is invalid.
              Fix on the Plans tab: {invalidTouPlans.map((p) => p.name).join(', ')}.
            </p>
          {/if}
          {#if periodAgg.generalWeekError}
            <p role="alert">
              Time-of-use plans can't be priced for this property's data: {periodAgg.generalWeekError}
            </p>
          {/if}

          {#if !cl1Applicable}
            <p class="note">
              CL1: not applicable (no controlled-load circuit). Any controlled-load rate on these
              plans contributed $0 to every total, because no register is mapped to that circuit for
              this property. Change this on the Usage data tab.
            </p>
          {/if}
          {#if !cl2Applicable}
            <p class="note">
              CL2: not applicable (no controlled-load circuit). Any controlled-load rate on these
              plans contributed $0 to every total, because no register is mapped to that circuit for
              this property. Change this on the Usage data tab.
            </p>
          {/if}

          <fieldset>
            <legend>Rank by</legend>
            <label class="inline">
              <input type="radio" name="rankBasis" value="bestCase" bind:group={rankBasis} />
              Best-case total
            </label>
            <label class="inline">
              <input type="radio" name="rankBasis" value="guaranteed" bind:group={rankBasis} />
              Guaranteed total
            </label>
          </fieldset>

          <p class="basis-statement">
            {#if rankBasis === 'bestCase'}
              Ranked by <strong>best-case total</strong>. Best case assumes every conditional
              discount (e.g. pay-on-time) is met. The guaranteed total — what you pay if you miss
              them — is shown on every card.
            {:else}
              Ranked by <strong>guaranteed total</strong>. The guaranteed total is what you pay
              regardless of any conditional discount. The best-case total — if you meet every
              condition — is shown on every card too.
            {/if}
          </p>

          <ol class="ranking">
            {#each rankedRows as { plan, bill, rank, isCheapest, deltaCents } (plan.id)}
              <li>
                <article class="bill" class:cheapest={isCheapest}>
                  <h3>
                    <span class="rank">#{rank}</span>
                    {plan.name} <span class="retailer">({plan.retailer})</span>
                    {#if isCheapest}<span class="cheapest-tag">Cheapest</span>{/if}
                    {#if bill.extrapolation}
                      <span class="estimated-tag">Estimated</span>
                    {/if}
                  </h3>
                  <dl>
                    <dt>Supply</dt>
                    <dd>{formatCents(bill.supplyCents)}</dd>

                    <dt>General usage</dt>
                    <dd>{formatCents(bill.generalUsageCents)}</dd>
                    {#if bill.bands}
                      <dd class="sub-wrap">
                        <ul class="sub">
                          {#each bill.bands as band, i (i)}
                            <li>{band.label}: {formatCents(band.cents)}</li>
                          {/each}
                        </ul>
                      </dd>
                    {/if}

                    {#if cl1Applicable}
                      <dt>CL1</dt>
                      <dd>{formatCents(bill.cl1Cents)}</dd>
                    {/if}
                    {#if cl2Applicable}
                      <dt>CL2</dt>
                      <dd>{formatCents(bill.cl2Cents)}</dd>
                    {/if}

                    <dt>Solar credit</dt>
                    <dd>{formatCents(-bill.solarCreditCents)}</dd>

                    <dt>Discounts</dt>
                    <dd>
                      {#if bill.discountLines.length === 0}
                        None
                      {:else}
                        {formatCents(
                          -(bill.guaranteedDiscountCents + bill.conditionalDiscountCents),
                        )}
                      {/if}
                    </dd>
                    {#if bill.discountLines.length > 0}
                      <dd class="sub-wrap">
                        <ul class="sub">
                          {#each bill.discountLines as line, i (i)}
                            <li>
                              {line.label ||
                                (line.kind === 'guaranteed' ? 'Guaranteed' : 'Conditional')}
                              ({line.kind}): {formatCents(-line.cents)}
                            </li>
                          {/each}
                        </ul>
                      </dd>
                    {/if}

                    <dt class="total-label" class:emphasis={rankBasis === 'guaranteed'}>
                      Guaranteed total
                    </dt>
                    <dd class="total" class:emphasis={rankBasis === 'guaranteed'}>
                      {formatCents(bill.guaranteedTotalCents)}
                    </dd>
                    <dt class="total-label" class:emphasis={rankBasis === 'bestCase'}>
                      Best-case total
                    </dt>
                    <dd class="total" class:emphasis={rankBasis === 'bestCase'}>
                      {formatCents(bill.bestCaseTotalCents)}
                    </dd>
                  </dl>
                  {#if !isCheapest}
                    <p class="delta">+{formatCents(deltaCents)} vs cheapest</p>
                  {/if}
                </article>
              </li>
            {/each}
          </ol>

          <fieldset>
            <legend>Usage shape</legend>
            <label class="inline">
              <input type="radio" name="shapeView" value="hourOfDay" bind:group={shapeView} />
              kWh by hour of day
            </label>
            <label class="inline">
              <input
                type="radio"
                name="shapeView"
                value="band"
                bind:group={shapeView}
                disabled={touRows.length === 0}
              />
              % of general usage per TOU band
            </label>
          </fieldset>

          {#if shapeView === 'hourOfDay'}
            {#if periodAgg.generalWeekError}
              <p class="note">Usage shape chart unavailable: {periodAgg.generalWeekError}</p>
            {:else if periodAgg.missingDows.length > 0}
              <p class="note">
                Usage shape chart unavailable: no General data for {periodAgg.missingDows.join(
                  ', ',
                )} in the sampled period, so an annual hour-of-day projection would be incomplete.
              </p>
            {:else}
              <UsageShapeChart
                data={hourOfDayData}
                format={(v) => `${v.toFixed(1)} kWh`}
                valueLabel={periodAgg.extrapolation
                  ? 'General kWh (estimated annual)'
                  : 'General kWh'}
                categoryLabel="Hour of day"
                tickEvery={3}
              />
            {/if}
          {:else if touRows.length > 0}
            <label>
              TOU plan
              <select
                value={effectiveTouPlanId}
                onchange={(e) => (selectedTouPlanId = e.currentTarget.value)}
              >
                {#each touRows as { plan } (plan.id)}
                  <option value={plan.id}>{plan.name}</option>
                {/each}
              </select>
            </label>
            <UsageShapeChart
              data={bandSharePercent}
              format={(v) => `${v.toFixed(1)}%`}
              valueLabel="% of general usage"
              categoryLabel="TOU band"
            />
          {:else}
            <!-- A disabled radio doesn't reset shapeView on its own — e.g. narrowing the period
                 or switching property can drop touRows to zero while 'band' is still selected. -->
            <p class="note">
              No priceable time-of-use plan is available to show band share for this property and
              period.
            </p>
          {/if}
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<style>
  .error {
    color: #b00020;
  }

  .note {
    color: #666;
    font-size: 0.875rem;
  }

  .banner {
    background: #f5a62322;
    border: 1px solid #f5a62366;
    border-radius: 4px;
    padding: 0.75rem 1rem;
    max-width: 40rem;
  }

  .period {
    display: flex;
    gap: 1.5rem;
    margin: 1rem 0;
  }

  fieldset {
    margin-top: 1rem;
  }

  label.inline {
    display: inline-block;
    margin-right: 1rem;
  }

  .basis-statement {
    max-width: 40rem;
  }

  ol.ranking {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .bill {
    border: 1px solid #8886;
    border-radius: 4px;
    padding: 1rem;
    max-width: 24rem;
  }

  .bill.cheapest {
    font-weight: 600;
    background: #27ae6022;
    box-shadow: inset 3px 0 0 0 #27ae60;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .rank {
    color: #666;
    font-weight: normal;
  }

  .cheapest-tag,
  .estimated-tag {
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* Translucent border + background over `color: inherit`, matching NonActualReadsBadge.svelte's
     and .banner's technique — composites correctly under `color-scheme: light dark` with no
     prefers-color-scheme block, unlike a hardcoded text color which can drop below WCAG AA
     contrast against a dark-mode card background. */
  .estimated-tag {
    color: inherit;
    background: #f5a62333;
    border: 1px solid #f5a62388;
    border-radius: 0.25rem;
    padding: 0.05rem 0.4rem;
  }

  .retailer {
    color: #666;
    font-weight: normal;
    font-size: 0.875rem;
  }

  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 1rem;
    margin: 0.5rem 0 0;
  }

  dt {
    color: #666;
  }

  dd {
    margin: 0;
    text-align: right;
  }

  dd.sub-wrap {
    grid-column: 1 / -1;
    text-align: left;
  }

  ul.sub {
    margin: 0.125rem 0 0;
    padding-left: 1.25rem;
    color: #666;
    font-size: 0.875rem;
  }

  .total-label {
    font-weight: bold;
    color: inherit;
  }

  .total {
    font-weight: bold;
  }

  .emphasis {
    font-size: 1.1em;
  }

  .delta {
    margin: 0.5rem 0 0;
    color: #666;
    font-size: 0.875rem;
  }
</style>
