<script lang="ts">
  interface Props {
    values: number[];
    width?: number;
    height?: number;
  }

  let { values, width = 120, height = 32 }: Props = $props();

  let max = $derived(values.reduce((m, v) => Math.max(m, v), 0));

  let peakIndex = $derived(
    values.length === 0 ? 0 : values.reduce((best, v, i) => (v > values[best] ? i : best), 0),
  );

  let points = $derived(
    values
      .map((v, i) => {
        const x = values.length > 1 ? (i / (values.length - 1)) * width : 0;
        const y = max > 0 ? height - (v / max) * height : height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' '),
  );

  let summary = $derived(`Average day shape; peak ${max.toFixed(2)} kWh at slot ${peakIndex}`);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={summary}>
  <title>{summary}</title>
  <polyline {points} fill="none" stroke="currentColor" stroke-width="1.5" />
</svg>
