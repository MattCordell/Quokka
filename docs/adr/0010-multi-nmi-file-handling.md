# ADR 0010: A multi-NMI file prompts the user to pick one NMI; properties are never merged

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

NEM12 files may legally contain more than one **NMI**. V1 scope is a single **Household** (§3). Silently merging two connections' data would produce a meaningless combined bill.

## Decision

On import, detect all distinct NMIs. If more than one is present, surface them and require the user to choose which connection to analyse. Store and analyse per-NMI; never merge NMIs. A single-NMI file skips the prompt.

## Consequences

- Preserves single-household scope while tolerating real-world multi-NMI exports.
- The chosen NMI keys the **Register Mapping** and persisted usage ([ADR-0008](0008-usage-persistence.md)); switching NMIs is a distinct dataset.
- Minor extra UI (an NMI picker) only when needed.

## Alternatives considered

- **Assume single NMI, hard-error on more than one.** Simpler but rejects legitimate multi-NMI files outright. Rejected in favour of a picker.
