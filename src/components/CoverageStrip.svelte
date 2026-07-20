<script lang="ts">
  import { TOU_DAYS } from '../lib/plan/types';
  import { GAP, OVERLAP } from '../lib/plan/coverage';

  interface Props {
    /** grid[dayIndex 0=MON..6=SUN][slotIndex]: -1 Gap, -2 Overlap, else the covering band's index. */
    grid: number[][];
    width?: number;
    rowHeight?: number;
  }

  let { grid, width = 320, rowHeight = 14 }: Props = $props();

  const LABEL_WIDTH = 28;

  let slotsPerDay = $derived(grid[0]?.length ?? 0);
  let gridWidth = $derived(width - LABEL_WIDTH);
  let cellWidth = $derived(slotsPerDay > 0 ? gridWidth / slotsPerDay : 0);
  let height = $derived(rowHeight * grid.length);

  // Golden-angle hue spacing gives every band index a distinct color with no fixed palette to
  // run out of or alias past (a plan can have arbitrarily many bands). Offset so band 0 (the
  // most common case — a single "All week" band) starts at blue, not red: red is GAP's color,
  // and a fully-covered plan shouldn't read as the error state.
  function cellFill(value: number): string {
    if (value === GAP) return '#e45756';
    if (value === OVERLAP) return 'url(#coverage-strip-overlap-hatch)';
    const hue = (200 + value * 137.508) % 360;
    return `hsl(${hue.toFixed(1)}, 60%, 50%)`;
  }

  let gapCount = $derived(grid.flat().filter((v) => v === GAP).length);
  let overlapCount = $derived(grid.flat().filter((v) => v === OVERLAP).length);
  let summary = $derived(
    gapCount === 0 && overlapCount === 0
      ? 'Weekly band coverage; fully covered, no gaps or overlaps'
      : `Weekly band coverage; ${gapCount} uncovered slot${gapCount === 1 ? '' : 's'}, ${overlapCount} overlapping slot${overlapCount === 1 ? '' : 's'}`,
  );
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={summary}>
  <title>{summary}</title>
  <defs>
    <pattern
      id="coverage-strip-overlap-hatch"
      width="4"
      height="4"
      patternTransform="rotate(45)"
      patternUnits="userSpaceOnUse"
    >
      <rect width="4" height="4" fill="#f2c94c" />
      <line x1="0" y1="0" x2="0" y2="4" stroke="#7a5b00" stroke-width="1.5" />
    </pattern>
  </defs>
  {#each TOU_DAYS as day, dayIndex (day)}
    <text x="0" y={dayIndex * rowHeight + rowHeight * 0.75} font-size={rowHeight * 0.7}>{day}</text>
    {#each grid[dayIndex] as value, slotIndex (slotIndex)}
      <rect
        x={LABEL_WIDTH + slotIndex * cellWidth}
        y={dayIndex * rowHeight}
        width={cellWidth}
        height={rowHeight}
        fill={cellFill(value)}
      />
    {/each}
  {/each}
</svg>
