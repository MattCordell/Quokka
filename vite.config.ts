import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/Quokka/',
  plugins: [svelte()],
  // node env suits today's pure-logic tests; component tests will need jsdom/happy-dom later.
  test: { environment: 'node', include: ['src/**/*.{test,spec}.ts'] },
});
