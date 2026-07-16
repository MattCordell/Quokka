# Test fixtures — all synthetic, safe to commit

Everything in this folder is **fabricated** — fake NMIs (`6407000000`+), fake meter
serials, made-up usage. It exists so tests run on committable data instead of the
**real** household export, which is git-ignored (see [`/.gitignore`](../.gitignore)).

> Never copy real NEM12/CSV data or the Origin PDFs into this folder. The repo is
> public; real interval data exposes the NMI, meter serials, and occupancy patterns.

Regenerate the CSVs with:

```
node fixtures/generate-fixtures.mjs
```

The generator is deterministic (no clock, no randomness) — re-running yields
byte-identical files. Format details it encodes were verified against a real Origin
NEM12 export during the design grilling (see [ADR-0001](../docs/adr/0001-tou-band-boundary-model.md),
[ADR-0003](../docs/adr/0003-quality-flag-handling.md), [glossary](../docs/glossary.md)).

## Contents

| File | Purpose | Key properties |
|---|---|---|
| `nem12/nem12-golden.csv` | **Golden oracle** for the calc engine + calibration test | 30-min, 2 clean weekdays, 3 registers (E1/B1/E3), round numbers |
| `nem12/nem12-quality-mixed.csv` | Parser stress: 5-min + estimated reads | 5-min (288/day), 3 days, one `V` day with `400` `F19` ranges, solar shape |
| `nem12/nem12-multi-nmi.csv` | ADR-0010 (must prompt to pick one NMI) | two NMIs in one file |
| `legacy-csv/legacy-sample.csv` | Deferred fallback format reference (ADR-0015) | long format, 30-min, 2 *unlabelled* Consumption + 1 Feed In per interval, reverse-chronological, `+10:00` |
| `plans/flat-plan.json` | Demo flat-rate plan | matches golden expected results |
| `plans/tou-plan.json` | Demo TOU plan | 3 bands covering all 168h, half-open, midnight-wrapping off-peak |
| `mapping/golden-register-mapping.json` | Register→category for the golden file | E1→General, B1→Generation, E3→CL1 |
| `expected/golden-bills.json` | Hand-computed expected bills | flat **$19.90**, TOU **$22.20** — the assertion oracle |

## The golden scenario (why the numbers are what they are)

Two weekdays (1–2 Jul 2025), 30-min intervals. Over the 2-day period:

- **General (E1):** 0.5 kWh/interval, except the peak window `[16:00, 21:00)` = 1.0 kWh
  → **20 kWh peak + 38 kWh off-peak = 58 kWh**
- **Controlled load (E3 → CL1):** 0.5 kWh in `[00:00, 02:00)` → **4 kWh**
- **Generation (B1):** 0.5 kWh in `[10:00, 14:00)` → **8 kWh**

| Plan | Supply | General | CL1 | Solar credit | **Total** |
|---|---|---|---|---|---|
| Flat (30c, supply 100+5c/day) | 210c | 1740c | 80c | −40c | **$19.90** |
| TOU (peak 50c / off-peak 25c, supply 110+5c/day) | 230c | 1950c | 80c | −40c | **$22.20** |

These exercise the load-bearing rules: half-open TOU band assignment ([ADR-0001](../docs/adr/0001-tou-band-boundary-model.md)),
CL charges only when a CL register is mapped ([ADR-0002](../docs/adr/0002-controlled-load-charges-require-circuit.md)),
inclusive day count ([ADR-0005](../docs/adr/0005-days-in-period.md)), and solar credit subtraction.
