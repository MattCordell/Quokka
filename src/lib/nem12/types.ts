/**
 * Parsed NEM12 output shape.
 *
 * `values[i]` is the kWh for the local-time slot `[i * intervalLength, (i + 1) * intervalLength)`
 * measured from midnight — i.e. index 0 is the first slot of the day. TOU band assignment
 * (ADR-0001) is slot-based, so it is robust to the interval-ending vs interval-beginning
 * labelling convention; only the series' offset depends on it. See ADR-0016 for how the
 * convention was confirmed.
 */
export interface RegisterDay {
  date: string; // YYYYMMDD, as declared in the 300 record
  values: number[]; // length === Register.intervalsPerDay, already converted to kWh
  quality: string[]; // length === values.length; resolved per-interval flag (A/F/S/N/...)
}

export interface Register {
  nmi: string;
  registerId: string;
  nmiSuffix: string;
  meterSerial: string;
  uom: string; // original declared UOM (e.g. 'Wh'), before conversion
  intervalLength: number; // minutes
  intervalsPerDay: number;
  days: RegisterDay[];
  totalKwh: number; // sum over all days, after UOM conversion
}

export interface NmiData {
  nmi: string;
  registers: Register[];
  firstDate: string;
  lastDate: string;
  dayCount: number;
}

export interface ParsedNem12 {
  nmis: NmiData[];
  multipleNmis: boolean;
}

export class Nem12ParseError extends Error {}
