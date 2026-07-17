<script lang="ts">
  import Plans from './screens/Plans.svelte';
  import Usage from './screens/Usage.svelte';

  type Tab = 'plans' | 'usage' | 'compare';
  let active = $state<Tab>('plans');
</script>

<nav>
  <button aria-current={active === 'plans' ? 'true' : undefined} onclick={() => (active = 'plans')}>
    Plans
  </button>
  <button aria-current={active === 'usage' ? 'true' : undefined} onclick={() => (active = 'usage')}>
    Usage data
  </button>
  <button
    aria-current={active === 'compare' ? 'true' : undefined}
    onclick={() => (active = 'compare')}
  >
    Compare
  </button>
</nav>

<main>
  {#if active === 'plans'}
    <Plans />
  {:else if active === 'usage'}
    <Usage />
  {:else}
    {#await import('./screens/Compare.svelte') then { default: Compare }}
      <Compare />
    {/await}
  {/if}
</main>
