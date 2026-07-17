import type { NmiData, ParsedNem12, Register, RegisterDay } from './types';
import { Nem12ParseError } from './types';

// ADR-0012: energy UOMs only; power/demand units (kW, kVA, kVAr, ...) are rejected.
// AEMO MDFF declares UOM codes in uppercase; real exports vary in case, so the lookup is
// case-insensitive while the register keeps the originally-declared casing for display.
const ENERGY_UOM_FACTORS: Record<string, number> = { KWH: 1, WH: 0.001, MWH: 1000 };

function uomFactor(uom: string, registerLabel: string): number {
  const factor = ENERGY_UOM_FACTORS[uom.trim().toUpperCase()];
  if (factor === undefined) {
    throw new Nem12ParseError(
      `Register ${registerLabel} declares unsupported UOM '${uom}' — only energy units (kWh, Wh, MWh) are accepted.`,
    );
  }
  return factor;
}

function parseValue(raw: string, factor: number, label: string, date: string): number {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  if (Number.isNaN(n)) {
    throw new Nem12ParseError(`Register ${label} day ${date}: non-numeric interval value '${raw}'`);
  }
  return n * factor;
}

function registerLabel(register: Register): string {
  return `${register.nmi}/${register.registerId}`;
}

export function parseNem12(text: string): ParsedNem12 {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

  const registers: Register[] = [];
  let currentRegister: Register | null = null;
  let currentDay: RegisterDay | null = null;
  let seenDates = new Set<string>();

  for (const line of lines) {
    const fields = line.split(',');
    const recordType = fields[0];

    switch (recordType) {
      case '100': {
        if (fields[1] !== 'NEM12') {
          throw new Nem12ParseError(
            `Expected a NEM12 file (100 record), got header '${fields[1]}'`,
          );
        }
        break;
      }

      case '200': {
        const [, nmi, , registerId, nmiSuffix, , meterSerial, uom, intervalLengthRaw] = fields;
        const intervalLength = Number(intervalLengthRaw);
        if (
          !Number.isInteger(intervalLength) ||
          intervalLength <= 0 ||
          1440 % intervalLength !== 0
        ) {
          throw new Nem12ParseError(
            `Register ${nmi}/${registerId}: interval length '${intervalLengthRaw}' does not divide evenly into a day`,
          );
        }
        // Validate the UOM up front so a bad register fails closed before any 300 row is parsed.
        uomFactor(uom, `${nmi}/${registerId}`);

        currentRegister = {
          nmi,
          registerId,
          nmiSuffix,
          meterSerial,
          uom,
          intervalLength,
          intervalsPerDay: 1440 / intervalLength,
          days: [],
          totalKwh: 0,
        };
        currentDay = null;
        seenDates = new Set();
        registers.push(currentRegister);
        break;
      }

      case '300': {
        if (!currentRegister) {
          throw new Nem12ParseError('300 row found before any 200 register header');
        }
        const label = registerLabel(currentRegister);
        const date = fields[1];
        if (seenDates.has(date)) {
          throw new Nem12ParseError(`Register ${label}: duplicate 300 row for day ${date}`);
        }
        const n = currentRegister.intervalsPerDay;
        if (fields.length < n + 3) {
          throw new Nem12ParseError(
            `Register ${label} day ${date}: expected ${n} interval values, found ${Math.max(0, fields.length - 3)}`,
          );
        }
        const factor = uomFactor(currentRegister.uom, label);
        const dayFlagField = fields[2 + n];
        const dayFlag = dayFlagField?.[0];
        if (!dayFlag || /^-?[0-9.]+$/.test(dayFlagField)) {
          throw new Nem12ParseError(
            `Register ${label} day ${date}: expected ${n} interval values, found more than ${n}`,
          );
        }
        const values: number[] = new Array(n);
        let dayTotal = 0;
        for (let i = 0; i < n; i++) {
          const v = parseValue(fields[2 + i], factor, label, date);
          values[i] = v;
          dayTotal += v;
        }
        // Non-V day flags carry a whole-day quality method (e.g. 'F19'); resolved per-interval
        // quality is a single char, matching the 400 override path below (ADR-0003).
        // A V day defaults to actual and is overwritten by 400 ranges below; ADR-0003 mandates
        // this default explicitly ("default any interval not covered by a 400 range to actual").
        const quality = dayFlag === 'V' ? new Array(n).fill('A') : new Array(n).fill(dayFlag);

        currentDay = { date, values, quality };
        currentRegister.days.push(currentDay);
        currentRegister.totalKwh += dayTotal;
        seenDates.add(date);
        break;
      }

      case '400': {
        if (!currentRegister || !currentDay) {
          throw new Nem12ParseError('400 row found with no preceding 300 row');
        }
        const label = registerLabel(currentRegister);
        const start = Number(fields[1]);
        const end = Number(fields[2]);
        const flag = fields[3]?.[0];
        const n = currentDay.quality.length;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end > n ||
          start > end ||
          !flag
        ) {
          throw new Nem12ParseError(
            `Register ${label} day ${currentDay.date}: invalid 400 range '${fields[1]}-${fields[2]}'`,
          );
        }
        for (let i = start - 1; i <= end - 1; i++) {
          currentDay.quality[i] = flag;
        }
        break;
      }

      case '900': {
        currentRegister = null;
        currentDay = null;
        break;
      }

      default:
        // Ignore record types outside the parser's scope (e.g. B2B configuration records).
        break;
    }
  }

  for (const register of registers) {
    register.days.sort((a, b) => a.date.localeCompare(b.date));
  }

  const nmis = groupByNmi(registers);
  return { nmis, multipleNmis: nmis.length > 1 };
}

function groupByNmi(registers: Register[]): NmiData[] {
  const byNmi = new Map<string, Register[]>();
  for (const register of registers) {
    const existing = byNmi.get(register.nmi);
    if (existing) {
      existing.push(register);
    } else {
      byNmi.set(register.nmi, [register]);
    }
  }

  return Array.from(byNmi.entries()).map(([nmi, regs]) => {
    const dates = new Set<string>();
    for (const r of regs) {
      for (const day of r.days) dates.add(day.date);
    }
    const sortedDates = Array.from(dates).sort();
    return {
      nmi,
      registers: regs,
      firstDate: sortedDates[0],
      lastDate: sortedDates[sortedDates.length - 1],
      dayCount: sortedDates.length,
    };
  });
}
