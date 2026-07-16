// Generates SYNTHETIC test fixtures for the QLD electricity comparison tool.
//
// Everything here is fabricated (fake NMIs, fake meter serials, made-up usage).
// It exists so tests can run on committable data instead of the real household
// file, which is git-ignored (see /.gitignore and fixtures/README.md).
//
// Run:  node fixtures/generate-fixtures.mjs
// Deterministic: no randomness, no clock — re-running produces byte-identical output.
//
// Format facts encoded here were verified against a real Origin NEM12 export
// during the grilling session (see docs/adr/0001, 0003; docs/glossary.md):
//   - 300 interval values are ordered from local midnight; value[i] covers
//     [i*L, (i+1)*L) minutes (L = interval length). Confirmed via solar shape.
//   - Day-level quality is A (actual) or V (variable -> read that day's 400 rows).
//   - 400 rows: 400,startInterval,endInterval,qualityMethod,reasonCode,  (1-based).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const out = (rel, text) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.replace(/\n/g, '\r\n'), 'ascii'); // NEM12 files are CRLF
  console.log('wrote', rel, `(${text.split('\n').length} lines)`);
};

const fmt = (v) => (v === 0 ? '0' : v.toFixed(4)); // bare 0, else 4dp (real files vary)

// Build one 300 row: date + N values + quality trailer.
const row300 = (date, values, dayFlag = 'A') =>
  ['300', date, ...values.map(fmt), dayFlag, '', '', '', ''].join(',');

const header100 = (created) => `100,NEM12,${created},,`;
const footer900 = () => '900';

// ---------------------------------------------------------------------------
// 1. GOLDEN — 30-min, 2 clean weekdays, hand-verifiable totals.
//    See fixtures/expected/golden-bills.json for the asserted results.
//    E1 general: 0.5/interval, except PEAK [16:00,21:00) (idx 32..41) = 1.0
//    B1 solar:   0.5 in [10:00,14:00) (idx 20..27), else 0
//    E3 CL:      0.5 in [00:00,02:00) (idx 0..3), else 0
// ---------------------------------------------------------------------------
{
  const N = 48; // 30-min
  const e1 = Array.from({ length: N }, (_, i) => (i >= 32 && i <= 41 ? 1.0 : 0.5));
  const b1 = Array.from({ length: N }, (_, i) => (i >= 20 && i <= 27 ? 0.5 : 0));
  const e3 = Array.from({ length: N }, (_, i) => (i >= 0 && i <= 3 ? 0.5 : 0));
  const days = ['20250701', '20250702']; // Tue, Wed — both weekday, peak applies
  const lines = [header100('202507030000')];
  const reg = (suffix, meter, vals) => {
    lines.push(`200,6407000000,E1B1E3,${suffix},${suffix},,${meter},kWh,30,`);
    for (const d of days) lines.push(row300(d, vals, 'A'));
  };
  reg('E1', 'METERGEN01', e1);
  reg('B1', 'METERGEN01', b1);
  reg('E3', 'METERCL01', e3);
  lines.push(footer900());
  out('nem12/nem12-golden.csv', lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// 2. QUALITY-MIXED — 5-min, 3 days, exercises 288-count parsing, realistic
//    solar shape, and a V day whose 400 rows mark a midday range estimated.
//    Totals are NOT asserted (only the golden is) — this is a parser fixture.
// ---------------------------------------------------------------------------
{
  const N = 288; // 5-min
  const tri = (i, peak, halfWidth, height) =>
    Math.max(0, (1 - Math.abs(i - peak) / halfWidth) * height);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // B1 solar: bump 07:00 (i=84) .. 16:00 (i=192), peak 11:30 (i=138)
  const b1 = Array.from({ length: N }, (_, i) =>
    i >= 84 && i <= 192 ? r4(tri(i, 138, 54, 0.30)) : 0);
  // E1 general: small base + evening rise 17:00 (204) .. 21:00 (252)
  const e1 = Array.from({ length: N }, (_, i) => r4(0.05 + (i >= 204 && i < 252 ? 0.15 : 0)));
  // E3 CL: overnight 00:00 (0) .. 03:00 (36)
  const e3 = Array.from({ length: N }, (_, i) => (i < 36 ? 0.08 : 0));

  const days = [
    { date: '20250703', flag: 'A', four: [] },
    // V day: intervals 145..180 (approx 12:00..15:00) are final-substitute estimates
    {
      date: '20250704',
      flag: 'V',
      four: [
        '400,1,144,A,,',
        '400,145,180,F19,79,',
        '400,181,288,A,,',
      ],
    },
    { date: '20250705', flag: 'A', four: [] },
  ];

  const lines = [header100('202507060000')];
  const reg = (suffix, meter, vals) => {
    lines.push(`200,6407000001,E1B1E3,${suffix},${suffix},,${meter},kWh,5,`);
    for (const d of days) {
      lines.push(row300(d.date, vals, d.flag));
      for (const f of d.four) lines.push(f);
    }
  };
  reg('E1', 'METERGEN05', e1);
  reg('B1', 'METERGEN05', b1);
  reg('E3', 'METERCL05', e3);
  lines.push(footer900());
  out('nem12/nem12-quality-mixed.csv', lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// 3. MULTI-NMI — two NMIs in one file, 30-min, one day each, single register.
//    Exercises ADR-0010 (must prompt the user to pick one; never merge).
// ---------------------------------------------------------------------------
{
  const N = 48;
  const flat = (k) => Array.from({ length: N }, () => k);
  const lines = [header100('202507030000')];
  const nmiBlock = (nmi, k) => {
    lines.push(`200,${nmi},E1,E1,E1,,METER${nmi.slice(-2)},kWh,30,`);
    lines.push(row300('20250701', flat(k), 'A'));
  };
  nmiBlock('6407000002', 0.4);
  nmiBlock('6407000003', 0.7);
  lines.push(footer900());
  out('nem12/nem12-multi-nmi.csv', lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// 4. LEGACY CSV (deferred format, ADR-0015) — long format, 30-min, reverse
//    chronological, TWO unlabelled Consumption rows + one Feed In per interval,
//    +10:00 (AEST, no DST). Kept only as a reference for the fallback parser.
// ---------------------------------------------------------------------------
{
  const lines = ['Usage Type,Amount Used,From (date/time),To (date/time)'];
  // 4 intervals on 2026-07-14, latest first (22:00..24:00)
  const slots = [
    ['23:30:00', '23:59:59', 0.534, 0.094, 0],
    ['23:00:00', '23:29:59', 0.488, 0.177, 0],
    ['22:30:00', '22:59:59', 0.483, 0.102, 0],
    ['22:00:00', '22:29:59', 0.451, 0.098, 0],
  ];
  const D = '2026-07-14';
  for (const [from, to, cons1, cons2, feed] of slots) {
    lines.push(`Consumption,${cons1},${D}T${from}+10:00,${D}T${to}+10:00`);
    lines.push(`Consumption,${cons2},${D}T${from}+10:00,${D}T${to}+10:00`);
    lines.push(`Feed In,${feed},${D}T${from}+10:00,${D}T${to}+10:00`);
  }
  out('legacy-csv/legacy-sample.csv', lines.join('\n') + '\n');
}

console.log('\nAll fixtures generated.');
