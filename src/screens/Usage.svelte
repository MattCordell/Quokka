<script lang="ts">
  import { Nem12ParseError, parseNem12 } from '../lib/nem12';
  import type { NmiData, ParsedNem12 } from '../lib/nem12';

  let error = $state<string | null>(null);
  let parsed = $state<ParsedNem12 | null>(null);
  let selectedNmi = $state<string | null>(null);
  let expandedDay = $state<Record<string, boolean>>({});

  let selected = $derived<NmiData | null>(
    parsed && selectedNmi ? (parsed.nmis.find((n) => n.nmi === selectedNmi) ?? null) : null,
  );

  async function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file to retry after an error
    if (!file) return;

    error = null;
    parsed = null;
    selectedNmi = null;
    expandedDay = {};

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
              <td colspan="8">
                <code>{firstDay.values.map((v) => v.toFixed(4)).join(', ')}</code>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
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
