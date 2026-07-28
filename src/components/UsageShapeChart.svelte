<script lang="ts">
  import { BarChart } from 'layerchart';
  import 'layerchart/core.css';

  interface DataPoint {
    label: string;
    value: number;
  }

  interface Props {
    data: DataPoint[];
    format: (value: number) => string;
    valueLabel: string;
    categoryLabel: string;
    tickEvery?: number;
    height?: number;
  }

  let { data, format, valueLabel, categoryLabel, tickEvery = 1, height = 220 }: Props = $props();

  let total = $derived(data.reduce((sum, d) => sum + d.value, 0));
  let summary = $derived(`${valueLabel} by ${categoryLabel}; total ${format(total)}`);
  let xTicks = $derived(data.filter((_, i) => i % tickEvery === 0).map((d) => d.label));
</script>

<figure class="chart">
  <!-- role="img" flattens its subtree from the a11y tree, so it wraps only the visual chart —
       the sr-only fallback table below stays a sibling, reachable by assistive tech. -->
  <div role="img" aria-label={summary}>
    <BarChart
      {data}
      x="label"
      y="value"
      {height}
      props={{
        xAxis: { ticks: xTicks },
        yAxis: { format },
      }}
    />
  </div>
  <table class="sr-only">
    <caption>{summary}</caption>
    <thead>
      <tr>
        <th>{categoryLabel}</th>
        <th>{valueLabel}</th>
      </tr>
    </thead>
    <tbody>
      {#each data as d, i (i)}
        <tr>
          <td>{d.label}</td>
          <td>{format(d.value)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</figure>

<style>
  .chart {
    margin: 0;
    color: currentColor;
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
