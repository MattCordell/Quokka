# ADR 0007: Discounts model guaranteed vs conditional separately and show both totals

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session
- **Supersedes:** the single flat-% discount in PRD §7.4

## Context

PRD §7.4 modelled a discount as one flat % applied to chosen components. Real QLD offers routinely combine a *guaranteed* discount (always applied, e.g. direct-debit) with a *conditional* one (applied only if a condition is met, e.g. pay-on-time). Collapsing both into one always-applied % overstates the price for anyone who might miss the condition, and hides the risk.

## Decision

The **Discount** model on a **Plan** distinguishes two kinds:

- **Guaranteed discount(s):** always applied.
- **Conditional discount(s):** applied only in the "best case" total.

Each discount carries its own **components** it applies to (usage only, or usage + supply), defaulting to usage + supply excluding the **Solar Credit** (per §7.4), editable per discount.

Every **Bill** therefore yields **two totals**:

- **Guaranteed total** — base less guaranteed discounts only.
- **Best-case total** — base less guaranteed *and* conditional discounts.

The **Comparison** table (§7.6) shows both, and ranking must state which total it ranks on (default: best-case, with the guaranteed total visible alongside).

Whether V1 supports *multiple* named discounts per plan or exactly one-guaranteed-plus-one-conditional is a scope call deferred to Round 3 ticketing; the data model should not preclude a list.

## Consequences

- Plan schema (§5.1) changes: `discount: %` becomes a list/pair of discount records, each `{kind: guaranteed|conditional, percent, components}`.
- Comparison view (§7.6) shows two totals per plan; ranking must declare its basis and let the user see the other.
- Honest handling of pay-on-time offers — the user sees both the price they'll pay if they slip and the price if they don't.
- Slightly more data entry and a busier table; accepted for the accuracy gain.

## Alternatives considered

- **Flat % always applied (PRD original).** Simple but overstates savings and hides conditional risk. Rejected.
- **Multiple named discounts with per-discount flags.** Most expressive; kept as a non-precluded future option but not mandated for V1, to bound entry/UI effort.
