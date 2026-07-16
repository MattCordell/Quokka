# ADR 0011: Many registers may map to one usage category; their kWh are summed

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

**Register Mapping** (§6) assigns each **Register** to a **Usage Category** (General/CL1/CL2/Generation/Ignore). Some meters split one logical load across multiple registers (e.g. two-phase supply with two General elements), so a one-to-one constraint would be wrong.

## Decision

A category may receive **multiple registers**; their interval values are **summed** per interval before pricing. `Ignore` absorbs any register the user does not want counted. A category may also receive zero registers (e.g. no CL — see [ADR-0002](0002-controlled-load-charges-require-circuit.md)).

## Consequences

- Handles multi-phase / multi-element meters correctly.
- Summing happens at the interval level, so **TOU** band assignment ([ADR-0001](0001-tou-band-boundary-model.md)) still operates on a single combined series per category.
- Registers summed into one category must share compatible **Interval Length** and **UOM**; a mismatch is a validation error worth surfacing at mapping time.

## Alternatives considered

- **Exactly one register per category.** Simpler validation but breaks split-load meters. Rejected.
