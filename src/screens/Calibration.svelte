<script lang="ts">
  import { loadPlans } from '../lib/storage/persistence';
  import { computeCalibration } from '../lib/calc';
  import type { CalibrationResult, ManualBillInput } from '../lib/calc';
  import type { FlatPlan } from '../lib/plan/types';
  import { formatCents } from '../lib/format';

  interface FormState {
    planId: string;
    periodStart: string;
    periodEnd: string;
    generalKwh: number;
    cl1Kwh: number | null;
    cl2Kwh: number | null;
    feedInKwh: number;
    actualDollars: number;
  }

  const flatPlans = loadPlans().filter((p): p is FlatPlan => p.type === 'flat_rate');

  function emptyForm(): FormState {
    return {
      planId: flatPlans[0]?.id ?? '',
      periodStart: '',
      periodEnd: '',
      generalKwh: 0,
      cl1Kwh: null,
      cl2Kwh: null,
      feedInKwh: 0,
      actualDollars: 0,
    };
  }

  let form = $state<FormState>(emptyForm());
  let error = $state<string | null>(null);
  let result = $state<CalibrationResult | null>(null);

  let selectedPlan = $derived(flatPlans.find((p) => p.id === form.planId) ?? null);

  function submitForm(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    result = null;

    if (!selectedPlan) {
      error = 'Select a flat-rate plan first.';
      return;
    }
    if (form.periodStart > form.periodEnd) {
      error = 'The period start must not be after the period end.';
      return;
    }

    const input: ManualBillInput = {
      period: { start: form.periodStart, end: form.periodEnd },
      generalKwh: form.generalKwh,
      cl1Kwh: form.cl1Kwh,
      cl2Kwh: form.cl2Kwh,
      feedInKwh: form.feedInKwh,
      actualCents: Math.round(form.actualDollars * 100),
    };

    result = computeCalibration(selectedPlan, input);
  }
</script>

<div class="calibration">
  <p>
    Enter the totals from one real invoice against a flat-rate plan to check the engine's arithmetic
    before trusting interval-based comparisons. Manual entry only supports flat-rate plans — a
    single bill total has no timestamps for a time-of-use split.
  </p>

  {#if flatPlans.length === 0}
    <p role="alert">Create a flat-rate plan on the Plans tab first.</p>
  {:else}
    <form onsubmit={submitForm}>
      <label>
        Plan
        <select bind:value={form.planId} required>
          {#each flatPlans as plan (plan.id)}
            <option value={plan.id}>{plan.name} ({plan.retailer})</option>
          {/each}
        </select>
      </label>

      <div class="period">
        <label>
          Period start
          <input type="date" bind:value={form.periodStart} required />
        </label>
        <label>
          Period end
          <input type="date" bind:value={form.periodEnd} required />
        </label>
      </div>

      <label>
        General usage (kWh)
        <input type="number" min="0" step="any" bind:value={form.generalKwh} required />
      </label>
      <label>
        Controlled Load 1 (kWh)
        <input
          type="number"
          min="0"
          step="any"
          bind:value={form.cl1Kwh}
          placeholder="not applicable"
        />
      </label>
      <label>
        Controlled Load 2 (kWh)
        <input
          type="number"
          min="0"
          step="any"
          bind:value={form.cl2Kwh}
          placeholder="not applicable"
        />
      </label>
      <label>
        Solar feed-in (kWh)
        <input type="number" min="0" step="any" bind:value={form.feedInKwh} required />
      </label>
      <label>
        Actual bill total ($)
        <input type="number" min="0" step="0.01" bind:value={form.actualDollars} required />
      </label>

      <button type="submit">Check calibration</button>
    </form>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if result}
      <article class="result">
        <h3>Calculated vs actual</h3>
        <dl class="summary">
          <dt>Calculated total</dt>
          <dd>{formatCents(result.bill.totalCents)}</dd>
          <dt>Actual total</dt>
          <dd>{formatCents(result.actualCents)}</dd>
          <dt class="total-label">Difference</dt>
          <dd class="total">{formatCents(result.differenceCents)}</dd>
          <dt>Variance</dt>
          <dd>{result.variancePct === null ? 'n/a' : `${result.variancePct.toFixed(2)}%`}</dd>
        </dl>

        {#if result.differenceCents !== 0}
          <p class="note">
            The engine rounds only the final total (ADR-0004), while a printed invoice rounds per
            line item — a cent-level difference may be that rounding convention rather than a
            data-entry error.
          </p>
        {/if}

        <h4>Breakdown</h4>
        <dl>
          <dt>Supply</dt>
          <dd>{formatCents(result.bill.supplyCents)}</dd>
          <dt>General usage</dt>
          <dd>{formatCents(result.bill.generalUsageCents)}</dd>
          <dt>CL1</dt>
          <dd>
            {result.bill.cl1Applicable ? formatCents(result.bill.cl1Cents) : 'not applicable'}
          </dd>
          <dt>CL2</dt>
          <dd>
            {result.bill.cl2Applicable ? formatCents(result.bill.cl2Cents) : 'not applicable'}
          </dd>
          <dt>Solar credit</dt>
          <dd>{formatCents(-result.bill.solarCreditCents)}</dd>
        </dl>
      </article>
    {/if}
  {/if}
</div>

<style>
  .error {
    color: #b00020;
  }

  .note {
    color: #666;
    font-size: 0.875rem;
  }

  form {
    margin-top: 1rem;
    max-width: 32rem;
  }

  form label {
    display: block;
    margin-top: 0.5rem;
  }

  .period {
    display: flex;
    gap: 1.5rem;
  }

  .result {
    border: 1px solid #8886;
    border-radius: 4px;
    padding: 1rem;
    margin-top: 1.5rem;
    max-width: 24rem;
  }

  .result h4 {
    margin-bottom: 0;
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
