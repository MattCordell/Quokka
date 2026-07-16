# ADR 0008: Persist parsed usage in local storage by NMI, with a one-click clear control

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Matt Cordell; grilling session

## Context

Plans persist in browser local storage (§7.1). The parsed interval **usage** could persist too or stay in memory. NEM12 is compact (~1,200 rows for the sample year), so size isn't the constraint; the tension is convenience vs the privacy posture (§8, "usage data never leaves the browser").

## Decision

**Persist parsed usage in browser local storage, keyed by NMI**, alongside plans and the **Register Mapping**. Persistence stays entirely on-device — nothing leaves the browser, so the privacy guarantee holds. Provide an explicit **"Clear my usage data"** control that purges stored usage (and optionally the mapping) on demand.

## Consequences

- Re-opening the tool restores usage + mapping; no re-upload each session.
- Privacy posture is preserved (on-device only) and made *controllable* — the user can wipe usage without clearing all browser data.
- Clearing browser data still loses everything; this must be stated to the user (already noted for plans in §8).
- Storage schema now versions three things (plans, usage-by-NMI, mapping-by-NMI+register); a schema-version field is advisable so future format changes can migrate rather than corrupt.
- Keep plans and usage in separate storage keys so "clear my usage" never risks the plan library.

## Alternatives considered

- **Memory only, re-import each session.** Strongest privacy (never written to disk) but re-upload friction every visit. Rejected in favour of persist + explicit purge.
- **Persist with no clear control.** Convenient but gives the user no on-device way to remove usage short of wiping all site data. Rejected.
