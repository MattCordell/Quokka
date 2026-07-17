<script lang="ts">
  import { loadPlans, savePlans } from '../lib/storage/persistence';
  import type { FlatPlan, Plan } from '../lib/plan/types';

  interface FormState {
    name: string;
    retailer: string;
    generalCentsPerDay: number;
    cl1CentsPerDay: number;
    cl2CentsPerDay: number;
    generalRateCentsPerKwh: number;
    cl1RateCentsPerKwh: number;
    cl2RateCentsPerKwh: number;
    feedInRateCentsPerKwh: number;
  }

  function emptyForm(): FormState {
    return {
      name: '',
      retailer: '',
      generalCentsPerDay: 0,
      cl1CentsPerDay: 0,
      cl2CentsPerDay: 0,
      generalRateCentsPerKwh: 0,
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

  function startCreate() {
    editingId = null;
    form = emptyForm();
  }

  function startEdit(plan: FlatPlan) {
    editingId = plan.id;
    form = {
      name: plan.name,
      retailer: plan.retailer,
      generalCentsPerDay: plan.supply.generalCentsPerDay,
      cl1CentsPerDay: plan.supply.cl1CentsPerDay,
      cl2CentsPerDay: plan.supply.cl2CentsPerDay,
      generalRateCentsPerKwh: plan.usage.generalRateCentsPerKwh,
      cl1RateCentsPerKwh: plan.controlledLoad.cl1RateCentsPerKwh,
      cl2RateCentsPerKwh: plan.controlledLoad.cl2RateCentsPerKwh,
      feedInRateCentsPerKwh: plan.feedInRateCentsPerKwh,
    };
  }

  function persist(next: Plan[]) {
    plans = next;
    const result = savePlans(next);
    saveWarning = result.ok ? null : result.message;
  }

  function submitForm(event: SubmitEvent) {
    event.preventDefault();

    const plan: FlatPlan = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name.trim(),
      retailer: form.retailer.trim(),
      type: 'flat_rate',
      supply: {
        generalCentsPerDay: form.generalCentsPerDay,
        cl1CentsPerDay: form.cl1CentsPerDay,
        cl2CentsPerDay: form.cl2CentsPerDay,
      },
      usage: { generalRateCentsPerKwh: form.generalRateCentsPerKwh },
      controlledLoad: {
        cl1RateCentsPerKwh: form.cl1RateCentsPerKwh,
        cl2RateCentsPerKwh: form.cl2RateCentsPerKwh,
      },
      feedInRateCentsPerKwh: form.feedInRateCentsPerKwh,
      discounts: [],
    };

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
    <h3>{editingId ? 'Edit plan' : 'New flat-rate plan'}</h3>

    <label>
      Plan name
      <input type="text" bind:value={form.name} required />
    </label>

    <label>
      Retailer
      <input type="text" bind:value={form.retailer} required />
    </label>

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
      <label>
        General
        <input type="number" min="0" step="1" bind:value={form.generalRateCentsPerKwh} required />
      </label>
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

    <p class="note">
      CL1/CL2 rates only apply to a household with a register mapped to that controlled-load circuit
      — otherwise they show as "not applicable" on a bill, regardless of what's entered here.
    </p>

    <button type="submit">{editingId ? 'Save changes' : 'Create plan'}</button>
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
              {#if p.type === 'flat_rate'}
                <button type="button" onclick={() => startEdit(p)}>Edit</button>
              {:else}
                TOU editing not supported yet
              {/if}
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

  fieldset {
    margin-top: 1rem;
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
