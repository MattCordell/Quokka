<script lang="ts">
  interface Props {
    days: number;
  }

  let { days }: Props = $props();
</script>

{#if days > 0}
  <p class="badge" role="status">
    ⚠ This period includes estimated or substituted reads on <strong>{days}</strong> day{days === 1
      ? ''
      : 's'}
  </p>
{/if}

<style>
  /* Translucent border + background over `color: inherit`, matching app.css's
     nav button[aria-current] technique — composites correctly under `color-scheme: light dark`
     with no prefers-color-scheme block and no CSS variable. */
  .badge {
    color: inherit;
    background: #f2c94c33;
    border: 1px solid #f2c94c88;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    margin: 1rem 0;
  }
</style>
