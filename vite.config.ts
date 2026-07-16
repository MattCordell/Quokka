import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/Quokka/',
  plugins: [svelte()],
  test: { environment: 'node', include: ['src/**/*.{test,spec}.ts'] },
});
