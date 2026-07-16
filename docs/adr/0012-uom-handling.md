# ADR 0012: Accept energy UOMs (convert Wh/MWh to kWh); reject power/demand units

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

Each **Register** declares a **UOM** in its `200` record. The sample is `kWh`, but the format permits others. Summing a demand/power unit (kW, kVA, kVAr) as if it were energy would silently misstate the bill.

## Decision

- Accept energy units: `kWh` used as-is; `Wh` and `MWh` converted to `kWh`.
- **Reject** power/demand units (`kW`, `kVA`, `kVAr`, etc.) and any unrecognised UOM with a clear error; do **not** compute a bill from them.
- Registers combined into one category ([ADR-0011](0011-register-mapping-cardinality.md)) must share a UOM after conversion.

## Consequences

- Guards against a whole class of silent unit-mismatch errors.
- V1 prices energy only; demand-charge tariffs remain out of scope (consistent with §7.4 and the CDR "structures we don't model" flag in §9.3).
- The parser must know the energy-UOM allowlist and fail closed on anything else.

## Alternatives considered

- **Accept kWh only.** Strictest, but rejects legitimate Wh/MWh files needlessly. Rejected.
- **Accept any UOM and sum blindly.** Silently wrong for power units. Rejected outright.
