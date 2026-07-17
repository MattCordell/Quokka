import type { NmiData } from '../nem12';
import type { RegisterMapping } from './types';

/**
 * Adopts stored categories for registers still present in the file; new registers default to
 * 'Ignore'; registers no longer present are dropped. Makes re-import silent when unchanged.
 */
export function reconcileMapping(
  stored: RegisterMapping | null,
  nmiData: NmiData,
): RegisterMapping {
  const registers: RegisterMapping['registers'] = {};
  for (const register of nmiData.registers) {
    registers[register.registerId] = stored?.registers[register.registerId] ?? 'Ignore';
  }
  return { nmi: nmiData.nmi, registers };
}
