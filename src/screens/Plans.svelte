<script lang="ts">
  import { loadPlans, savePlans } from '../lib/storage/persistence';
  import {
    DISCOUNT_COMPONENTS,
    TOU_DAYS,
    type Discount,
    type Plan,
    type TouBand,
  } from '../lib/plan/types';
  import { analyzeCoverage, formatTime, parseTime } from '../lib/plan/coverage';
  import {
    applyPlanImport,
    copyPlan,
    exportPlans,
    parsePlanImport,
    planExportFilename,
    type ImportChoice,
    type PlanImportResult,
  } from '../lib/plan/transfer';
  import { downloadTextFile } from '../lib/download';
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
    discounts: Discount[];
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

  // 'conditional' is the conservative default direction: mis-recording a conditional discount as
  // guaranteed understates the guaranteed total (promises a price the user might not get), while
  // the reverse merely overstates guaranteed while best-case stays correct (ADR-0007).
  function defaultDiscount(): Discount {
    return {
      id: crypto.randomUUID(),
      label: '',
      kind: 'conditional',
      percent: 0,
      components: [...DISCOUNT_COMPONENTS],
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
      discounts: [],
    };
  }

  let plans = $state<Plan[]>(loadPlans());
  let saveWarning = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let form = $state<FormState>(emptyForm());

  let importResult = $state<PlanImportResult | null>(null);
  let importChoices = $state<Record<number, ImportChoice>>({});
  let importMode = $state<'merge' | 'replace'>('merge');
  let importError = $state<string | null>(null);
  let confirmingReplace = $state(false);

  // Only meaningful while form.type === 'time_of_use'; null otherwise.
  let coverage = $derived(form.type === 'time_of_use' ? analyzeCoverage(form.touBands, 30) : null);

  // A discount with no component selected would price as a silent 0% — `required` can't express
  // "at least one of this checkbox group", so it's checked here instead.
  let discountErrors = $derived(form.discounts.map((d) => d.components.length === 0));
  let discountPercentSum = $derived(form.discounts.reduce((sum, d) => sum + d.percent, 0));

  let formValid = $derived(
    (form.type !== 'time_of_use' || !!coverage?.ok) && !discountErrors.some((e) => e),
  );

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
      // components is a nested array — a shallow spread would alias the persisted plan and let
      // an abandoned edit mutate loaded state.
      discounts: plan.discounts.map((d) => ({ ...d, components: [...d.components] })),
    };
  }

  function addBand() {
    form.touBands = [...form.touBands, defaultBand()];
  }

  function removeBand(index: number) {
    form.touBands = form.touBands.filter((_, i) => i !== index);
  }

  function addDiscount() {
    form.discounts = [...form.discounts, defaultDiscount()];
  }

  function removeDiscount(index: number) {
    form.discounts = form.discounts.filter((_, i) => i !== index);
  }

  function persist(next: Plan[]) {
    plans = next;
    const result = savePlans(next);
    saveWarning = result.ok ? null : result.message;
  }

  function submitForm(event: SubmitEvent) {
    event.preventDefault();
    if (!formValid) return;

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
      discounts: form.discounts.map((d) => ({ ...d, components: [...d.components] })),
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

  function describeDiscounts(plan: Plan): string {
    if (plan.discounts.length === 0) return 'None';
    return plan.discounts
      .map(
        (d) =>
          `${d.label || (d.kind === 'guaranteed' ? 'Guaranteed' : 'Conditional')} ${d.percent}%`,
      )
      .join(', ');
  }

  function deletePlan(id: string) {
    persist(plans.filter((p) => p.id !== id));
    confirmingDeleteId = null;
    if (editingId === id) startCreate();
  }

  function duplicatePlan(plan: Plan) {
    persist([...plans, copyPlan(plan, { name: `${plan.name} (copy)` })]);
  }

  function exportAll() {
    downloadTextFile(planExportFilename(plans), exportPlans(plans));
  }

  function exportOne(plan: Plan) {
    downloadTextFile(planExportFilename([plan]), exportPlans([plan]));
  }

  function cancelImport() {
    importResult = null;
    importChoices = {};
    confirmingReplace = false;
  }

  async function onImportFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file to retry after an error
    if (!file) return;

    importError = null;
    importMode = 'merge';
    cancelImport();

    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      importError = `Could not read the file: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }

    const result = parsePlanImport(text, plans);
    if (result.candidates.length === 0) {
      importError = result.issues[0]?.message ?? 'Import failed.';
      return;
    }

    importResult = result;
    const defaults: Record<number, ImportChoice> = {};
    for (const candidate of result.candidates) {
      if (candidate.collision) defaults[candidate.sourceIndex] = 'keep-both';
    }
    importChoices = defaults;
  }

  function confirmMergeImport() {
    if (!importResult) return;
    persist(applyPlanImport(plans, importResult.candidates, importChoices, 'merge'));
    cancelImport();
  }

  function confirmReplaceImport() {
    if (!importResult) return;
    persist(applyPlanImport(plans, importResult.candidates, importChoices, 'replace'));
    cancelImport();
  }
</script>

<section>
  <h2>Plans</h2>
  <p>All rates are GST-inclusive.</p>

  {#if saveWarning}
    <p class="error" role="alert">Could not save plans on this device: {saveWarning}</p>
  {/if}

  <section class="transfer">
    <h3>Import / export</h3>
    <button type="button" onclick={exportAll} disabled={plans.length === 0}>
      Export all plans
    </button>
    <label>
      Import plans from a JSON file
      <input type="file" accept=".json,application/json" onchange={onImportFileChange} />
    </label>

    {#if importError}
      <p class="error" role="alert">{importError}</p>
    {/if}

    {#if importResult}
      <div class="import-review">
        <fieldset>
          <legend>Import mode</legend>
          <label class="inline">
            <input type="radio" name="importMode" value="merge" bind:group={importMode} />
            Merge into library
          </label>
          <label class="inline">
            <input type="radio" name="importMode" value="replace" bind:group={importMode} />
            Replace whole library
          </label>
        </fieldset>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Retailer</th>
              <th>Type</th>
              <th>Status</th>
              <th><span class="sr-only">Choice</span></th>
            </tr>
          </thead>
          <tbody>
            {#each importResult.candidates as candidate (candidate.sourceIndex)}
              <tr>
                <td>{candidate.plan.name || '(unnamed)'}</td>
                <td>{candidate.plan.retailer || '(unknown)'}</td>
                <td>{candidate.plan.type === 'flat_rate' ? 'Flat rate' : 'Time of use'}</td>
                <td>
                  {#if !candidate.importable}
                    {#each candidate.issues.filter((i) => i.type === 'plan-shape' || i.type === 'band-coverage') as issue, i (i)}
                      <p class="error" role="alert">{issue.message}</p>
                    {/each}
                    {#each candidate.issues.filter((i) => i.type === 'inclusive-end-normalised' || i.type === 'unknown-field' || i.type === 'duplicate-id-in-file') as issue, i (i)}
                      <p class="note">{issue.message}</p>
                    {/each}
                  {:else}
                    {#if candidate.collision}
                      <p class="note">
                        Collides (by {candidate.collision.kind}) with "{candidate.collision
                          .existingLabel}".
                      </p>
                    {/if}
                    {#each candidate.issues.filter((i) => i.type === 'inclusive-end-normalised' || i.type === 'unknown-field' || i.type === 'duplicate-id-in-file') as issue, i (i)}
                      <p class="note">{issue.message}</p>
                    {/each}
                  {/if}
                </td>
                <td>
                  {#if candidate.importable && candidate.collision && importMode === 'merge'}
                    <fieldset class="choice">
                      <legend class="sr-only">Choice for {candidate.plan.name}</legend>
                      <label class="inline">
                        <input
                          type="radio"
                          name="importChoice{candidate.sourceIndex}"
                          value="skip"
                          bind:group={importChoices[candidate.sourceIndex]}
                        />
                        Skip
                      </label>
                      <label class="inline">
                        <input
                          type="radio"
                          name="importChoice{candidate.sourceIndex}"
                          value="keep-both"
                          bind:group={importChoices[candidate.sourceIndex]}
                        />
                        Keep both
                      </label>
                      <label class="inline">
                        <input
                          type="radio"
                          name="importChoice{candidate.sourceIndex}"
                          value="overwrite"
                          bind:group={importChoices[candidate.sourceIndex]}
                        />
                        Overwrite
                      </label>
                    </fieldset>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if importMode === 'merge'}
          <button
            type="button"
            onclick={confirmMergeImport}
            disabled={!importResult.candidates.some((c) => c.importable)}
          >
            Import
          </button>
        {:else if confirmingReplace}
          <p class="note">
            {importResult.candidates.filter((c) => c.importable).length} imported plans will replace your
            {plans.length} saved plans.
          </p>
          <button type="button" onclick={confirmReplaceImport}>Confirm replace</button>
          <button type="button" onclick={() => (confirmingReplace = false)}>Cancel</button>
        {:else}
          <button
            type="button"
            onclick={() => (confirmingReplace = true)}
            disabled={!importResult.candidates.some((c) => c.importable)}
          >
            Replace whole library
          </button>
        {/if}

        <button type="button" onclick={cancelImport}>Cancel import</button>
      </div>
    {/if}
  </section>

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

    <fieldset>
      <legend>Discounts</legend>

      {#each form.discounts as discount, i (discount.id)}
        <fieldset class="discount">
          <legend>Discount {i + 1}</legend>
          <label>
            Label
            <input type="text" bind:value={discount.label} placeholder="e.g. Pay on time" />
          </label>
          <fieldset class="kind">
            <legend>Kind</legend>
            <label class="inline">
              <input
                type="radio"
                name="discountKind{i}"
                value="guaranteed"
                bind:group={discount.kind}
              />
              Guaranteed
            </label>
            <label class="inline">
              <input
                type="radio"
                name="discountKind{i}"
                value="conditional"
                bind:group={discount.kind}
              />
              Conditional
            </label>
          </fieldset>
          <label>
            Percent (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              bind:value={discount.percent}
              required
            />
          </label>
          <fieldset class="components">
            <legend>Applies to</legend>
            {#each DISCOUNT_COMPONENTS as component (component)}
              <label class="inline">
                <input type="checkbox" bind:group={discount.components} value={component} />
                {component === 'usage' ? 'Usage' : 'Supply charge'}
              </label>
            {/each}
          </fieldset>
          {#if discountErrors[i]}
            <p class="error" role="alert">
              Select at least one component this discount applies to.
            </p>
          {/if}
          <button type="button" onclick={() => removeDiscount(i)}>Remove discount</button>
        </fieldset>
      {/each}

      <button type="button" onclick={addDiscount}>Add discount</button>

      {#if discountPercentSum > 100}
        <p class="note">
          These discount percentages sum to over 100% — double-check this is intentional.
        </p>
      {/if}

      <p class="note">
        A guaranteed discount always applies; a conditional discount (e.g. pay-on-time) only applies
        to the best-case total (ADR-0007).
      </p>
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

    <button type="submit" disabled={!formValid}>
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
          <th>Discounts</th>
          <th><span class="sr-only">Edit</span></th>
          <th><span class="sr-only">Duplicate</span></th>
          <th><span class="sr-only">Export</span></th>
          <th><span class="sr-only">Delete</span></th>
        </tr>
      </thead>
      <tbody>
        {#each plans as p (p.id)}
          <tr>
            <td>{p.name}</td>
            <td>{p.retailer}</td>
            <td>{p.type === 'flat_rate' ? 'Flat rate' : 'Time of use'}</td>
            <td>{describeDiscounts(p)}</td>
            <td>
              <button type="button" onclick={() => startEdit(p)}>Edit</button>
            </td>
            <td>
              <button type="button" onclick={() => duplicatePlan(p)}>Duplicate</button>
            </td>
            <td>
              <button type="button" onclick={() => exportOne(p)}>Export</button>
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

  .transfer {
    margin-top: 1rem;
  }

  .import-review {
    margin-top: 1rem;
  }

  .import-review table {
    margin-top: 0.75rem;
  }

  fieldset.choice {
    border: none;
    padding: 0;
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

  fieldset.discount {
    border: 1px solid #8886;
    margin-top: 0.75rem;
  }

  fieldset.days,
  fieldset.kind,
  fieldset.components {
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
