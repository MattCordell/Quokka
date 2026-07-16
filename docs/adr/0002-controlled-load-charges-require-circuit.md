# ADR 0002: Controlled-load charges apply only when the household has that CL circuit

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

A **Plan** can define CL1/CL2 daily supply charges and usage rates (PRD §5.1, §7.4). The combined supply charge in §7.4 sums General + CL1 + CL2. But whether a given *household* actually has a controlled-load circuit is a property of the meter, not the plan — established by the **Register Mapping** (§6), where the user assigns a register to CL1/CL2 (or doesn't).

If a plan's CL charges are applied regardless, any plan that merely *lists* a CL tariff is penalised for a circuit this household would never use, distorting the **Comparison** ranking.

## Decision

CLn supply charge **and** CLn usage cost are included in a bill **only if a register is mapped to CLn** for this household. If no register maps to CLn, both the CLn daily supply charge and CLn usage cost contribute **$0** to every plan's bill, regardless of what the plan's tariff lists.

The combined daily supply charge in §7.4 therefore becomes: `General + (CL1 supply if CL1 mapped) + (CL2 supply if CL2 mapped)`.

## Consequences

- Cross-plan comparison is fair: plans are compared on the circuits this household actually has.
- The bill breakdown should still make the omission visible — e.g. show "CL1: not applicable (no controlled-load circuit)" rather than silently dropping the line — so the user understands why a listed rate had no effect.
- Ties bill correctness to the accuracy of the Register Mapping: if the user mis-maps (or ignores) their CL register, CL charges vanish. The one-time mapping confirmation (§6) is the guard.
- Calibration (§5.2 manual entry) supplies CL kWh directly, so this rule only governs the interval-data path.

## Alternatives considered

- **Always apply what the plan defines.** Literal but distorts ranking; rejected.
- **Per-plan toggle.** More control but more UI and more ways to misconfigure; the register mapping already carries the ground truth, so a toggle would duplicate it. Rejected.
