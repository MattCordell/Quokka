import type { CalibrationResult } from '../lib/calc';

export interface CalibrationFormState {
  planId: string;
  periodStart: string;
  periodEnd: string;
  generalKwh: number | null;
  cl1Kwh: number | null;
  cl2Kwh: number | null;
  feedInKwh: number | null;
  actualDollars: number | null;
}

function emptyForm(): CalibrationFormState {
  return {
    planId: '',
    periodStart: '',
    periodEnd: '',
    generalKwh: null,
    cl1Kwh: null,
    cl2Kwh: null,
    feedInKwh: null,
    actualDollars: null,
  };
}

/**
 * Module-scope (not component-local) state: a filled-in manual-entry form and its result
 * survive switching away from the Usage tab or the "Enter single bill" sub-tab and back —
 * `Calibration.svelte` is unmounted by both `Usage.svelte`'s sub-tab toggle and `App.svelte`'s
 * top-level nav. Manual entry is deliberately not persisted to local storage (a one-off sanity
 * check, not NMI-keyed data per ADR-0008), but losing several typed fields to an incidental
 * navigation is an easy trip-up worth avoiding without introducing full persistence.
 */
export const calibrationState = $state({
  form: emptyForm(),
  error: null as string | null,
  result: null as CalibrationResult | null,
});
