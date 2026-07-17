import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Nem12ParseError, parseNem12 } from './index';

function readFixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/nem12/${name}`, import.meta.url), 'utf-8');
}

function nem12(records: string[]): string {
  return ['100,NEM12,202501010000,,', ...records, '900'].join('\r\n');
}

describe('golden fixture', () => {
  const parsed = parseNem12(readFixture('nem12-golden.csv'));

  it('parses a single NMI with 3 registers', () => {
    expect(parsed.multipleNmis).toBe(false);
    expect(parsed.nmis).toHaveLength(1);
    const [nmi] = parsed.nmis;
    expect(nmi.nmi).toBe('6407000000');
    expect(nmi.registers).toHaveLength(3);
    expect(nmi.firstDate).toBe('20250701');
    expect(nmi.lastDate).toBe('20250702');
    expect(nmi.dayCount).toBe(2);
  });

  it('carries register metadata (id, serial, interval length)', () => {
    const [nmi] = parsed.nmis;
    const e1 = nmi.registers.find((r) => r.registerId === 'E1')!;
    const e3 = nmi.registers.find((r) => r.registerId === 'E3')!;
    expect(e1.meterSerial).toBe('METERGEN01');
    expect(e3.meterSerial).toBe('METERCL01');
    expect(e1.intervalLength).toBe(30);
    expect(e1.intervalsPerDay).toBe(48);
  });

  it('matches the golden totals (E1=58, B1=8, E3=4 kWh)', () => {
    const [nmi] = parsed.nmis;
    const totals = Object.fromEntries(nmi.registers.map((r) => [r.registerId, r.totalKwh]));
    expect(totals.E1).toBeCloseTo(58);
    expect(totals.B1).toBeCloseTo(8);
    expect(totals.E3).toBeCloseTo(4);
  });

  it('places the peak window at indices 32-41 (16:00-21:00, 0-based half-open slots)', () => {
    const [nmi] = parsed.nmis;
    const e1 = nmi.registers.find((r) => r.registerId === 'E1')!;
    const day = e1.days.find((d) => d.date === '20250701')!;
    expect(day.values.slice(32, 42)).toEqual(new Array(10).fill(1.0));
    expect(day.values[31]).toBeCloseTo(0.5);
    expect(day.values[42]).toBeCloseTo(0.5);
  });
});

describe('quality-mixed fixture', () => {
  const parsed = parseNem12(readFixture('nem12-quality-mixed.csv'));

  it('resolves the V day using its 400 ranges (A 0-143, F 144-179, A 180-287)', () => {
    const [nmi] = parsed.nmis;
    for (const register of nmi.registers) {
      const day = register.days.find((d) => d.date === '20250704')!;
      expect(day.quality.slice(0, 144)).toEqual(new Array(144).fill('A'));
      expect(day.quality.slice(144, 180)).toEqual(new Array(36).fill('F'));
      expect(day.quality.slice(180, 288)).toEqual(new Array(108).fill('A'));
    }
  });

  it('leaves A days fully actual', () => {
    const [nmi] = parsed.nmis;
    const e1 = nmi.registers.find((r) => r.registerId === 'E1')!;
    const day = e1.days.find((d) => d.date === '20250703')!;
    expect(day.quality.every((q) => q === 'A')).toBe(true);
  });
});

describe('multi-nmi fixture', () => {
  it('detects both NMIs and keeps registers unmerged', () => {
    const parsed = parseNem12(readFixture('nem12-multi-nmi.csv'));
    expect(parsed.multipleNmis).toBe(true);
    expect(parsed.nmis).toHaveLength(2);
    const [first, second] = parsed.nmis;
    expect(first.nmi).toBe('6407000002');
    expect(second.nmi).toBe('6407000003');
    expect(first.registers).toHaveLength(1);
    expect(second.registers).toHaveLength(1);
    expect(first.registers[0].totalKwh).not.toBe(second.registers[0].totalKwh);
  });
});

describe('UOM handling (ADR-0012)', () => {
  it('converts Wh to kWh (÷1000)', () => {
    const text = nem12(['200,NMI1,CFG,E1,E1,,SERIAL,Wh,1440,', '300,20250101,1000,A,,,,']);
    const parsed = parseNem12(text);
    expect(parsed.nmis[0].registers[0].totalKwh).toBeCloseTo(1);
    expect(parsed.nmis[0].registers[0].days[0].values[0]).toBeCloseTo(1);
  });

  it('converts MWh to kWh (x1000)', () => {
    const text = nem12(['200,NMI1,CFG,E1,E1,,SERIAL,MWh,1440,', '300,20250101,1,A,,,,']);
    const parsed = parseNem12(text);
    expect(parsed.nmis[0].registers[0].totalKwh).toBeCloseTo(1000);
  });

  it.each(['kW', 'kVA', 'kVAr', 'bogus'])(
    'rejects power/unknown UOM %s, naming the register',
    (uom) => {
      const text = nem12([`200,NMI1,CFG,E1,E1,,SERIAL,${uom},1440,`, '300,20250101,1,A,,,,']);
      expect(() => parseNem12(text)).toThrow(Nem12ParseError);
      expect(() => parseNem12(text)).toThrow(/NMI1\/E1/);
    },
  );
});

describe('300 row validation', () => {
  it('throws (no truncation) when the value count does not match the declared interval length', () => {
    const text = nem12(['200,NMI1,CFG,E1,E1,,SERIAL,kWh,30,', '300,20250101,1,2,3,4,5,A,,,,']);
    expect(() => parseNem12(text)).toThrow(Nem12ParseError);
    expect(() => parseNem12(text)).toThrow(/NMI1\/E1 day 20250101: expected 48 interval values/);
  });

  it('throws on a duplicate 300 row for the same day instead of double-counting it', () => {
    const text = nem12([
      '200,NMI1,CFG,E1,E1,,SERIAL,kWh,1440,',
      '300,20250101,1,A,,,,',
      '300,20250101,1,A,,,,',
    ]);
    expect(() => parseNem12(text)).toThrow(Nem12ParseError);
    expect(() => parseNem12(text)).toThrow(/NMI1\/E1: duplicate 300 row for day 20250101/);
  });
});

describe('200 row validation', () => {
  it('rejects a non-positive interval length', () => {
    const text = nem12(['200,NMI1,CFG,E1,E1,,SERIAL,kWh,-30,', '300,20250101,1,A,,,,']);
    expect(() => parseNem12(text)).toThrow(Nem12ParseError);
    expect(() => parseNem12(text)).toThrow(/NMI1\/E1: interval length '-30'/);
  });
});

describe('day ordering', () => {
  it("sorts a register's days chronologically regardless of file order", () => {
    const text = nem12([
      '200,NMI1,CFG,E1,E1,,SERIAL,kWh,1440,',
      '300,20250103,3,A,,,,',
      '300,20250101,1,A,,,,',
      '300,20250102,2,A,,,,',
    ]);
    const parsed = parseNem12(text);
    expect(parsed.nmis[0].registers[0].days.map((d) => d.date)).toEqual([
      '20250101',
      '20250102',
      '20250103',
    ]);
  });
});

describe('line endings', () => {
  it('parses both CRLF and LF input identically', () => {
    const crlf = readFixture('nem12-golden.csv');
    const lf = crlf.replace(/\r\n/g, '\n');
    const parsedCrlf = parseNem12(crlf);
    const parsedLf = parseNem12(lf);
    expect(parsedLf.nmis[0].registers.map((r) => r.totalKwh)).toEqual(
      parsedCrlf.nmis[0].registers.map((r) => r.totalKwh),
    );
  });
});
