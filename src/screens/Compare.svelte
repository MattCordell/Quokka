<script lang="ts">
  import { listStoredNmis, loadUsage, loadMapping, loadPlans } from '../lib/storage/persistence';
  import {
    aggregateUsage,
    aggregateGeneralWeek,
    daysInPeriod,
    priceFlatBill,
    priceTouBill,
    compactToIso,
  } from '../lib/calc';
  import { validateBandCoverage } from '../lib/plan/coverage';
  import type { FlatPlan, TouPlan } from '../lib/plan/types';
  import { formatCents } from '../lib/format';

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

  // Drop any manual date-range edits whenever the selected NMI's usage changes, so the period
  // defaults back to the full data span for the newly selected property.
  $effect(() => {
    void usage;
    startOverride = null;
    endOverride = null;
  });

  function clamp(value: string, min: string, max: string): string {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  // Clamped to the actual data span regardless of what the override holds — the date inputs'
  // min/max are advisory only (a keyboard-typed out-of-range value still fires onchange), and an
  // unclamped override would inflate daysInPeriod (and so the supply charge) past what usage
  // data actually backs.
  let period = $derived.by(() => {
    if (!usage) return null;
    const min = compactToIso(usage.firstDate);
    const max = compactToIso(usage.lastDate);
    return {
      start: clamp(startOverride ?? min, min, max),
      end: clamp(endOverride ?? max, min, max),
    };
  });

  let periodValid = $derived(!!period && period.start <= period.end);

  // aggregateUsage/aggregateGeneralWeek depend only on usage/mapping/period, not on any plan's
  // rates, so they're hoisted here and priced per plan below rather than re-aggregated inside a
  // per-plan call — O(data + plans) instead of O(data x plans). generalWeek is skipped entirely
  // when there are no priceable TOU plans, since it's otherwise wasted work on every period edit.
  let periodAgg = $derived.by(() => {
    if (!usage || !mapping || !period || !periodValid) return null;
    return {
      period,
      days: daysInPeriod(period),
      agg: aggregateUsage(usage, mapping, period),
      generalWeek:
        priceableTouPlans.length > 0 ? aggregateGeneralWeek(usage, mapping, period) : new Map(),
    };
  });

  let rows = $derived.by(() => {
    if (!periodAgg) return [];
    const { period: p, days, agg, generalWeek } = periodAgg;
    const flatRows = flatPlans.map((plan) => ({ plan, bill: priceFlatBill(plan, agg, days, p) }));
    const touRows = priceableTouPlans.map((plan) => ({
      plan,
      bill: priceTouBill(plan, agg, generalWeek, days, p),
    }));
    return [...flatRows, ...touRows];
  });

  let hasNonActualReads = $derived(periodAgg?.agg.hasNonActualReads ?? false);
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
        <!-- `|| null` (not just the raw value): clearing a date input via backspace fires
             onchange with '', which would otherwise bypass the ?? default above and feed an
             unparseable date into daysInPeriod. -->
        <div class="period">
          <label>
            Start
            <input
              type="date"
              min={compactToIso(usage.firstDate)}
              max={compactToIso(usage.lastDate)}
              value={period.start}
              onchange={(e) => (startOverride = e.currentTarget.value || null)}
            />
          </label>
          <label>
            End
            <input
              type="date"
              min={compactToIso(usage.firstDate)}
              max={compactToIso(usage.lastDate)}
              value={period.end}
              onchange={(e) => (endOverride = e.currentTarget.value || null)}
            />
          </label>
        </div>

        {#if !periodValid}
          <p class="error" role="alert">The start date must not be after the end date.</p>
        {:else}
          {#if hasNonActualReads}
            <p role="alert">This period includes estimated or substituted reads.</p>
          {/if}
          {#if invalidTouPlans.length > 0}
            <p role="alert">
              {invalidTouPlans.length} time-of-use plan{invalidTouPlans.length === 1 ? '' : 's'}
              {invalidTouPlans.length === 1 ? "isn't" : "aren't"} shown here — Band Coverage is invalid.
              Fix on the Plans tab: {invalidTouPlans.map((p) => p.name).join(', ')}.
            </p>
          {/if}

          {#each rows as { plan, bill } (plan.id)}
            <article class="bill">
              <h3>{plan.name} <span class="retailer">({plan.retailer})</span></h3>
              <dl>
                <dt>Supply</dt>
                <dd>{formatCents(bill.supplyCents)}</dd>
                {#if bill.bands}
                  {#each bill.bands as band, i (i)}
                    <dt>{band.label}</dt>
                    <dd>{formatCents(band.cents)}</dd>
                  {/each}
                {:else}
                  <dt>General usage</dt>
                  <dd>{formatCents(bill.generalUsageCents)}</dd>
                {/if}
                <dt>CL1</dt>
                <dd>{bill.cl1Applicable ? formatCents(bill.cl1Cents) : 'not applicable'}</dd>
                <dt>CL2</dt>
                <dd>{bill.cl2Applicable ? formatCents(bill.cl2Cents) : 'not applicable'}</dd>
                <dt>Solar credit</dt>
                <dd>{formatCents(-bill.solarCreditCents)}</dd>
                <dt class="total-label">Total</dt>
                <dd class="total">{formatCents(bill.totalCents)}</dd>
              </dl>
            </article>
          {/each}
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<style>
  .error {
    color: #b00020;
  }

  .period {
    display: flex;
    gap: 1.5rem;
    margin: 1rem 0;
  }

  fieldset {
    margin-top: 1rem;
  }

  .bill {
    border: 1px solid #8886;
    border-radius: 4px;
    padding: 1rem;
    margin-top: 1rem;
    max-width: 24rem;
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

  .total-label {
    font-weight: bold;
    color: inherit;
  }

  .total {
    font-weight: bold;
  }
</style>
