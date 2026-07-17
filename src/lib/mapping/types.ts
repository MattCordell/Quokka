/**
 * Usage Category vocabulary (glossary.md) and the Register Mapping shape.
 * `registers` is keyed by registerId, mirroring fixtures/mapping/golden-register-mapping.json.
 * This assumes registerId is unique within an NMI, which holds for every fixture (registerId
 * === nmiSuffix) but isn't guaranteed by the NEM12 spec in general. A composite
 * `registerId/nmiSuffix` key is the fallback if a real file ever produces a collision.
 */
export const USAGE_CATEGORIES = ['General', 'CL1', 'CL2', 'Generation', 'Ignore'] as const;

export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

export interface RegisterMapping {
  nmi: string;
  registers: Record<string, UsageCategory>;
}
