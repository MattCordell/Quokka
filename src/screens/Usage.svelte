<script lang="ts">
  import { Nem12ParseError, parseNem12 } from '../lib/nem12';
  import type { NmiData, ParsedNem12 } from '../lib/nem12';
  import { USAGE_CATEGORIES } from '../lib/mapping/types';
  import type { RegisterMapping, UsageCategory } from '../lib/mapping/types';
  import { reconcileMapping } from '../lib/mapping/reconcile';
  import { validateMapping, type MappingIssue } from '../lib/mapping/validate';
  import { saveUsage, loadMapping, saveMapping, clearAllUsage } from '../lib/storage/persistence';
  import { averageDayShape } from '../lib/usage/shape';
  import Sparkline from '../components/Sparkline.svelte';

  let error = $state<string | null>(null);
  let parsed = $state<ParsedNem12 | null>(null);
  let selectedNmi = $state<string | null>(null);
  let expandedDay = $state<Record<string, boolean>>({});

  let mapping = $state<RegisterMapping | null>(null);
  let mappingIssues = $state<MappingIssue[]>([]);
  let saveWarning = $state<string | null>(null);
  let confirmingClear = $state(false);

  let selected = $derived<NmiData | null>(
    parsed && selectedNmi ? (parsed.nmis.find((n) => n.nmi === selectedNmi) ?? null) : null,
  );

  // On every fresh parse (incl. re-import) of the selected NMI: persist usage (ADR-0008), then
  // reconcile against any stored Register Mapping so an unchanged re-import needs no re-prompt.
  $effect(() => {
    if (!selected) {
      mapping = null;
      mappingIssues = [];
      saveWarning = null;
      return;
    }
    const usageResult = saveUsage(selected);
    saveWarning = usageResult.ok ? null : usageResult.message;

    const stored = loadMapping(selected.nmi);
    const reconciled = reconcileMapping(stored, selected);
    mapping = reconciled;
    mappingIssues = validateMapping(selected.registers, reconciled).issues;
  });

  async function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file to retry after an error
    if (!file) return;

    error = null;
    parsed = null;
    selectedNmi = null;
    expandedDay = {};
    confirmingClear = false;

    try {
      const text = await file.text();
      parsed = parseNem12(text);
      // ADR-0010: a multi-NMI file requires an explicit choice; a single NMI needs no prompt.
      selectedNmi = parsed.nmis.length === 1 ? parsed.nmis[0].nmi : null;
    } catch (e) {
      error = e instanceof Nem12ParseError ? e.message : `Unexpected error: ${String(e)}`;
    }
  }

  function toggleDay(key: string) {
    expandedDay = { ...expandedDay, [key]: !expandedDay[key] };
  }

  function setCategory(registerId: string, category: UsageCategory) {
    if (!mapping || !selected) return;
    const next: RegisterMapping = {
      ...mapping,
      registers: { ...mapping.registers, [registerId]: category },
    };
    mapping = next;

    const result = validateMapping(selected.registers, next);
    mappingIssues = result.issues;
    if (result.ok) {
      const saveResult = saveMapping(next);
      saveWarning = saveResult.ok ? null : saveResult.message;
    }
  }

  function clearUsageData() {
    clearAllUsage({ includeMapping: true });
    parsed = null;
    selectedNmi = null;
    expandedDay = {};
    mapping = null;
    mappingIssues = [];
    saveWarning = null;
    confirmingClear = false;
  }
</script>

<section>
  <h2>Usage data</h2>
  <p>Upload a NEM12 interval-data export (.csv) to inspect its registers.</p>

  <label>
    NEM12 file
    <input type="file" accept=".csv,text/csv" onchange={onFileChange} />
  </label>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if saveWarning}
    <p class="error" role="alert">Could not save usage on this device: {saveWarning}</p>
  {/if}

  {#if parsed && parsed.nmis.length === 0}
    <p role="alert">No registers found in this file.</p>
  {/if}

  {#if parsed && parsed.multipleNmis}
    <fieldset>
      <legend
        >This file contains multiple NMIs — pick one to inspect (never merged, ADR-0010)</legend
      >
      {#each parsed.nmis as nmi (nmi.nmi)}
        <label>
          <input
            type="radio"
            name="nmi"
            value={nmi.nmi}
            checked={selectedNmi === nmi.nmi}
            onchange={() => (selectedNmi = nmi.nmi)}
          />
          {nmi.nmi} ({nmi.registers.length} register{nmi.registers.length === 1 ? '' : 's'})
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if selected}
    <h3>NMI {selected.nmi}</h3>
    <p>{selected.firstDate} &ndash; {selected.lastDate} ({selected.dayCount} days)</p>

    <table>
      <thead>
        <tr>
          <th>Register</th>
          <th>Meter serial</th>
          <th>UOM</th>
          <th>Interval length</th>
          <th>Days</th>
          <th>Date range</th>
          <th>Total kWh</th>
          <th>Shape</th>
          <th>Usage category</th>
          <th><span class="sr-only">Preview</span></th>
        </tr>
      </thead>
      <tbody>
        {#each selected.registers as register (`${register.registerId}/${register.nmiSuffix}`)}
          {@const key = `${selected.nmi}/${register.registerId}/${register.nmiSuffix}`}
          {@const firstDay = register.days[0]}
          {@const lastDay = register.days[register.days.length - 1]}
          <tr>
            <td>{register.registerId}</td>
            <td>{register.meterSerial}</td>
            <td>{register.uom}</td>
            <td>{register.intervalLength} min</td>
            <td>{register.days.length}</td>
            <td>{firstDay?.date} &ndash; {lastDay?.date}</td>
            <td>{register.totalKwh.toFixed(2)}</td>
            <td><Sparkline values={averageDayShape(register)} /></td>
            <td>
              <label>
                <span class="sr-only">Usage category for {register.registerId}</span>
                <select
                  value={mapping?.registers[register.registerId] ?? 'Ignore'}
                  onchange={(e) =>
                    setCategory(
                      register.registerId,
                      (e.currentTarget as HTMLSelectElement).value as UsageCategory,
                    )}
                >
                  {#each USAGE_CATEGORIES as category (category)}
                    <option value={category}>{category}</option>
                  {/each}
                </select>
              </label>
            </td>
            <td>
              {#if firstDay}
                <button type="button" onclick={() => toggleDay(key)}>
                  {expandedDay[key] ? 'Hide' : 'Preview'}
                  {firstDay.date}
                </button>
              {/if}
            </td>
          </tr>
          {#if firstDay && expandedDay[key]}
            <tr>
              <td colspan="10">
                <code>{firstDay.values.map((v) => v.toFixed(4)).join(', ')}</code>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>

    {#if mappingIssues.length > 0}
      <p class="error" role="alert">
        Register Mapping has issues: {mappingIssues.map((issue) => issue.message).join(' ')}
      </p>
    {:else if mapping}
      <p role="status">Register Mapping confirmed.</p>
    {/if}
  {/if}

  {#if parsed}
    <div class="clear">
      {#if confirmingClear}
        <p role="alert">
          This removes all stored usage and Register Mappings for every NMI on this device. Clearing
          browser data loses everything regardless — usage never leaves your browser.
        </p>
        <button type="button" onclick={clearUsageData}>Confirm clear</button>
        <button type="button" onclick={() => (confirmingClear = false)}>Cancel</button>
      {:else}
        <button type="button" onclick={() => (confirmingClear = true)}>Clear my usage data</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .error {
    color: #b00020;
  }

  table {
    border-collapse: collapse;
    margin-top: 1rem;
    width: 100%;
  }

  th,
  td {
    border: 1px solid #8886;
    padding: 0.375rem 0.75rem;
    text-align: left;
  }

  code {
    display: block;
    max-height: 8rem;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  fieldset {
    margin-top: 1rem;
  }

  .clear {
    margin-top: 1.5rem;
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
