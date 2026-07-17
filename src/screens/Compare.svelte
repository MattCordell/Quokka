<script lang="ts">
  import { listStoredNmis, loadUsage, loadMapping, loadPlans } from '../lib/storage/persistence';
  import { computeFlatBill, compactToIso } from '../lib/calc';
  import type { FlatPlan } from '../lib/plan/types';

  const nmis = listStoredNmis();
  let selectedNmi = $state<string | null>(nmis.length === 1 ? nmis[0] : null);
  const plans = loadPlans();
  const flatPlans = plans.filter((p): p is FlatPlan => p.type === 'flat_rate');
  const touPlanCount = plans.length - flatPlans.length;

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

  let period = $derived.by(() => {
    if (!usage) return null;
    return {
      start: startOverride ?? compactToIso(usage.firstDate),
      end: endOverride ?? compactToIso(usage.lastDate),
    };
  });

  let periodValid = $derived(!!period && period.start <= period.end);

  let rows = $derived.by(() => {
    if (!usage || !mapping || !period || !periodValid) return [];
    const u = usage;
    const m = mapping;
    const p = period;
    return flatPlans.map((plan) => ({ plan, bill: computeFlatBill(plan, u, m, p) }));
  });

  // Every Bill already carries this flag (computeFlatBill aggregates once internally) — reuse
  // it instead of re-running the full register/day/interval aggregation a second time.
  let hasNonActualReads = $derived(rows.some((row) => row.bill.hasNonActualReads));

  function formatCents(cents: number): string {
    const dollars = cents / 100;
    const sign = dollars < 0 ? '-' : '';
    return `${sign}$${Math.abs(dollars).toFixed(2)}`;
  }
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
      {:else if flatPlans.length === 0}
        <p role="alert">
          {plans.length === 0
            ? 'Create a plan on the Plans tab first.'
            : 'No flat-rate plans to compare (time-of-use billing is not supported yet).'}
        </p>
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
          {#if touPlanCount > 0}
            <p>
              {touPlanCount} time-of-use plan{touPlanCount === 1 ? '' : 's'} not shown — TOU billing isn't
              supported yet.
            </p>
          {/if}

          {#each rows as { plan, bill } (plan.id)}
            <article class="bill">
              <h3>{plan.name} <span class="retailer">({plan.retailer})</span></h3>
              <dl>
                <dt>Supply</dt>
                <dd>{formatCents(bill.supplyCents)}</dd>
                <dt>General usage</dt>
                <dd>{formatCents(bill.generalUsageCents)}</dd>
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
