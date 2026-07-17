# Quokka

Electricity Retail Comparator

A static, client-side tool for comparing QLD electricity retail plans against your own usage data. Built with Svelte 5 + TypeScript + Vite, deployed to [GitHub Pages](https://mattcordell.github.io/Quokka/) on every merge to `main`.

## Requirements

Node 20.19+ or 22.12+ (developed against Node 22).

## Development

```
npm install
npm run dev
```

The app is served under the `/Quokka/` base path (matching GitHub Pages); Vite redirects the bare dev-server root there automatically.

## Verification

```
npm run check         # svelte-check + tsc
npm run lint          # eslint
npm run format:check  # prettier --check
npm run test          # vitest
npm run build         # production build to dist/
```

`npm run preview` serves the production build; note the app is served under the `/Quokka/` base path (matching GitHub Pages), so open `http://localhost:4173/Quokka/`.
