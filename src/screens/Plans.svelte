<script lang="ts">
  import { loadPlans, savePlans } from '../lib/storage/persistence';
  import { TOU_DAYS, type Plan, type TouBand } from '../lib/plan/types';
  import { analyzeCoverage, formatTime, parseTime } from '../lib/plan/coverage';
  import CoverageStrip from '../components/CoverageStrip.svelte';

  interface FormState {
    type: 'flat_rate' | 'time_of_use';
    name: string;
    retailer: string;
    generalCentsPerDay: number;
    cl1CentsPerDay: number;
    cl2CentsPerDay: number;
    generalRateCentsPerKwh: number;
    touBands: TouBand[];
    cl1RateCentsPerKwh: number;
    cl2RateCentsPerKwh: number;
    feedInRateCentsPerKwh: number;
  }

  // 30-min grid (ADR-0001): "starts" options are inclusive marks 00:00-23:30; "ends" options
  // are the exclusive marks 00:30-24:00 the half-open band boundary is actually stored as.
  const START_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => formatTime(i * 30));
  const END_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => formatTime((i + 1) * 30));

  function defaultBand(): TouBand {
    return {
      label: 'All week',
      startTime: '00:00',
      endTime: '24:00',
      rateCentsPerKwh: 0,
      days: [...TOU_DAYS],
    };
  }

  function emptyForm(): FormState {
    return {
      type: 'flat_rate',
      name: '',
      retailer: '',
      generalCentsPerDay: 0,
      cl1CentsPerDay: 0,
      cl2CentsPerDay: 0,
      generalRateCentsPerKwh: 0,
      touBands: [defaultBand()],
      cl1RateCentsPerKwh: 0,
      cl2RateCentsPerKwh: 0,
      feedInRateCentsPerKwh: 0,
    };
  }

  let plans = $state<Plan[]>(loadPlans());
  let saveWarning = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let form = $state<FormState>(emptyForm());

  // Only meaningful while form.type === 'time_of_use'; null otherwise.
  let coverage = $derived(form.type === 'time_of_use' ? analyzeCoverage(form.touBands, 30) : null);

  function startCreate() {
    editingId = null;
    form = emptyForm();
  }

  function startEdit(plan: Plan) {
    editingId = plan.id;
    form = {
      type: plan.type,
      name: plan.name,
      retailer: plan.retailer,
      generalCentsPerDay: plan.supply.generalCentsPerDay,
      cl1CentsPerDay: plan.supply.cl1CentsPerDay,
      cl2CentsPerDay: plan.supply.cl2CentsPerDay,
      generalRateCentsPerKwh: plan.type === 'flat_rate' ? plan.usage.generalRateCentsPerKwh : 0,
      touBands:
        plan.type === 'time_of_use'
          ? plan.touBands.map((b) => ({ ...b, days: [...b.days] }))
          : [defaultBand()],
      cl1RateCentsPerKwh: plan.controlledLoad.cl1RateCentsPerKwh,
      cl2RateCentsPerKwh: plan.controlledLoad.cl2RateCentsPerKwh,
      feedInRateCentsPerKwh: plan.feedInRateCentsPerKwh,
    };
  }

  function addBand() {
    form.touBands = [...form.touBands, defaultBand()];
  }

  function removeBand(index: number) {
    form.touBands = form.touBands.filter((_, i) => i !== index);
  }

  function persist(next: Plan[]) {
    plans = next;
    const result = savePlans(next);
    saveWarning = result.ok ? null : result.message;
  }

  function submitForm(event: SubmitEvent) {
    event.preventDefault();
    if (form.type === 'time_of_use' && !coverage?.ok) return;

    const base = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name.trim(),
      retailer: form.retailer.trim(),
      supply: {
        generalCentsPerDay: form.generalCentsPerDay,
        cl1CentsPerDay: form.cl1CentsPerDay,
        cl2CentsPerDay: form.cl2CentsPerDay,
      },
      controlledLoad: {
        cl1RateCentsPerKwh: form.cl1RateCentsPerKwh,
        cl2RateCentsPerKwh: form.cl2RateCentsPerKwh,
      },
      feedInRateCentsPerKwh: form.feedInRateCentsPerKwh,
      discounts: [] as never[],
    };

    const plan: Plan =
      form.type === 'flat_rate'
        ? {
            ...base,
            type: 'flat_rate',
            usage: { generalRateCentsPerKwh: form.generalRateCentsPerKwh },
          }
        : { ...base, type: 'time_of_use', touBands: form.touBands };

    const next = editingId ? plans.map((p) => (p.id === editingId ? plan : p)) : [...plans, plan];

    persist(next);
    startCreate();
  }

  function deletePlan(id: string) {
    persist(plans.filter((p) => p.id !== id));
    confirmingDeleteId = null;
    if (editingId === id) startCreate();
  }
</script>

<section>
  <h2>Plans</h2>
  <p>All rates are GST-inclusive.</p>

  {#if saveWarning}
    <p class="error" role="alert">Could not save plans on this device: {saveWarning}</p>
  {/if}

  <form onsubmit={submitForm}>
    <h3>
      {editingId ? 'Edit plan' : form.type === 'flat_rate' ? 'New flat-rate plan' : 'New TOU plan'}
    </h3>

    <label>
      Plan name
      <input type="text" bind:value={form.name} required />
    </label>

    <label>
      Retailer
      <input type="text" bind:value={form.retailer} required />
    </label>

    <fieldset>
      <legend>Plan type</legend>
      <label class="inline">
        <input type="radio" name="planType" value="flat_rate" bind:group={form.type} />
        Flat rate
      </label>
      <label class="inline">
        <input type="radio" name="planType" value="time_of_use" bind:group={form.type} />
        Time of use
      </label>
    </fieldset>

    <fieldset>
      <legend>Supply charges (c/day)</legend>
      <label>
        General
        <input type="number" min="0" step="1" bind:value={form.generalCentsPerDay} required />
      </label>
      <label>
        CL1
        <input type="number" min="0" step="1" bind:value={form.cl1CentsPerDay} required />
      </label>
      <label>
        CL2
        <input type="number" min="0" step="1" bind:value={form.cl2CentsPerDay} required />
      </label>
    </fieldset>

    <fieldset>
      <legend>Usage rates (c/kWh)</legend>
      {#if form.type === 'flat_rate'}
        <label>
          General
          <input type="number" min="0" step="1" bind:value={form.generalRateCentsPerKwh} required />
        </label>
      {/if}
      <label>
        CL1
        <input type="number" min="0" step="1" bind:value={form.cl1RateCentsPerKwh} required />
      </label>
      <label>
        CL2
        <input type="number" min="0" step="1" bind:value={form.cl2RateCentsPerKwh} required />
      </label>
      <label>
        Feed-in (solar credit)
        <input type="number" min="0" step="1" bind:value={form.feedInRateCentsPerKwh} required />
      </label>
    </fieldset>

    {#if form.type === 'time_of_use'}
      <fieldset>
        <legend>TOU bands (General usage)</legend>

        {#each form.touBands as band, i (i)}
          <fieldset class="band">
            <legend>Band {i + 1}</legend>
            <label>
              Label
              <input type="text" bind:value={band.label} required />
            </label>
            <label>
              Starts
              <select bind:value={band.startTime}>
                {#each START_TIME_OPTIONS as t (t)}
                  <option value={t}>{t}</option>
                {/each}
              </select>
            </label>
            <label>
              Ends
              <select bind:value={band.endTime}>
                {#each END_TIME_OPTIONS as t (t)}
                  <option value={t}>{t}</option>
                {/each}
              </select>
            </label>
            <p class="note">
              Covers up to {formatTime(parseTime(band.endTime) - 1)}
            </p>
            <label>
              Rate (c/kWh)
              <input type="number" min="0" step="1" bind:value={band.rateCentsPerKwh} required />
            </label>
            <fieldset class="days">
              <legend>Days</legend>
              {#each TOU_DAYS as day (day)}
                <label class="inline">
                  <input type="checkbox" bind:group={band.days} value={day} />
                  {day}
                </label>
              {/each}
            </fieldset>
            <button type="button" onclick={() => removeBand(i)}>Remove band</button>
          </fieldset>
        {/each}

        <button type="button" onclick={addBand}>Add band</button>

        <div class="coverage">
          <CoverageStrip grid={coverage?.grid ?? []} />
          {#if coverage && !coverage.ok}
            <div class="coverage-errors" role="alert">
              <p>Cannot save — Band Coverage is invalid:</p>
              {#each coverage.misaligned as label, i (i)}
                <p>Misaligned boundary: {label}</p>
              {/each}
              {#each coverage.gaps as g, i (i)}
                <p>Gap: {g.day} {g.range}</p>
              {/each}
              {#each coverage.overlaps as o, i (i)}
                <p>Overlap: {o.day} {o.range}</p>
              {/each}
            </div>
          {/if}
        </div>
      </fieldset>
    {/if}

    <p class="note">
      CL1/CL2 rates only apply to a household with a register mapped to that controlled-load circuit
      — otherwise they show as "not applicable" on a bill, regardless of what's entered here.
    </p>

    <button type="submit" disabled={form.type === 'time_of_use' && !coverage?.ok}>
      {editingId ? 'Save changes' : 'Create plan'}
    </button>
    {#if editingId}
      <button type="button" onclick={startCreate}>Cancel edit</button>
    {/if}
  </form>

  {#if plans.length > 0}
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Retailer</th>
          <th>Type</th>
          <th><span class="sr-only">Edit</span></th>
          <th><span class="sr-only">Delete</span></th>
        </tr>
      </thead>
      <tbody>
        {#each plans as p (p.id)}
          <tr>
            <td>{p.name}</td>
            <td>{p.retailer}</td>
            <td>{p.type === 'flat_rate' ? 'Flat rate' : 'Time of use'}</td>
            <td>
              <button type="button" onclick={() => startEdit(p)}>Edit</button>
            </td>
            <td>
              {#if confirmingDeleteId === p.id}
                <button type="button" onclick={() => deletePlan(p.id)}>Confirm delete</button>
                <button type="button" onclick={() => (confirmingDeleteId = null)}>Cancel</button>
              {:else}
                <button type="button" onclick={() => (confirmingDeleteId = p.id)}>Delete</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p>No plans saved yet — create one above.</p>
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

  form {
    margin-top: 1rem;
    max-width: 32rem;
  }

  form label {
    display: block;
    margin-top: 0.5rem;
  }

  form label.inline {
    display: inline-block;
    margin-right: 1rem;
  }

  fieldset {
    margin-top: 1rem;
  }

  fieldset.band {
    border: 1px solid #8886;
    margin-top: 0.75rem;
  }

  fieldset.days {
    border: none;
    padding: 0;
  }

  .coverage {
    margin-top: 0.75rem;
  }

  .coverage-errors {
    color: #b00020;
  }

  table {
    border-collapse: collapse;
    margin-top: 1.5rem;
    width: 100%;
  }

  th,
  td {
    border: 1px solid #8886;
    padding: 0.375rem 0.75rem;
    text-align: left;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
