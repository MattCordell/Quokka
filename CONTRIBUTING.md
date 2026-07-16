# Contributing to Quokka

Ways of working for this repo. Short version: **issue → branch → PR → review → merge**, every time.

## 1. Every change starts from an issue

No work happens without a tracking issue — a feature ticket (see the vertical-slice tickets already in the issue tracker) or a bug report. This keeps the "why" attached to the change permanently, not just in a commit message.

- Feature tickets: title, "What to build" (user-facing behaviour), acceptance criteria, "Blocked by". Generated via the `to-tickets` skill for planned work, or written by hand for smaller asks.
- Bug reports: use the bug report issue template (repro steps, expected vs actual, environment).
- If a change doesn't fit an existing issue, open one first — even a one-line issue is enough for a trivial fix.

## 2. One branch per issue

Create a dedicated branch when work starts on an issue. Suggested naming: `issue-<number>-<short-slug>`, e.g. `issue-3-nem12-parser`. Never commit directly to `main`.

## 3. Commits

- Conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, …) with a brief body explaining *why*, not just what.
- Reference the issue in commits or the PR body (`Refs #3`); use `Closes #3` in the PR description so merging auto-closes the ticket.

## 4. Open a pull request

- PR description links the issue (`Closes #N`) and summarises the change against that issue's acceptance criteria.
- Keep PRs sized to one issue — the tickets are already cut as vertical slices for this reason. Don't bundle unrelated fixes into the same PR.
- CI must be green before requesting review: typecheck, lint, unit tests, build. Any change touching the calc engine must keep the **golden calibration test** ([fixtures/expected/golden-bills.json](fixtures/expected/golden-bills.json)) passing — that test is the acceptance gate for the whole calc engine (ADR-0015), not just its own ticket.

## 5. Review before merge

Every PR gets reviewed before merging — run `/code-review` (or `/review` for an already-open PR) over the diff as the review pass. Since this is currently a solo-maintained repo, self-review via the review skill stands in for a second pair of eyes; treat its findings the same as a human reviewer's.

**Merge bar: no major defects.** Major = wrong calc/money math, breaks the golden calibration test, violates an accepted ADR, leaks real usage data into the public repo, or breaks CI. Minor nits (naming, a missing test for an edge case that isn't load-bearing, style) don't have to block merge — file a quick follow-up issue instead of stalling the PR.

## 6. Data & privacy (this repo is public)

- Never commit anything under `Example Files/` or `docs/*.pdf`, or any real NMI, meter serial, or usage figures — they're git-ignored for a reason. If a PR needs new test data, add synthetic fixtures under `fixtures/` instead ([fixtures/README.md](fixtures/README.md)) and regenerate via `fixtures/generate-fixtures.mjs`.
- Before pushing, skim `git status`/`git diff` for anything that looks like it came from real data, even if the filename looks innocuous.

## 7. ADRs are binding

Decisions in [docs/adr/](docs/adr/) are accepted rules, not suggestions. If an implementation reveals an ADR should change, don't silently diverge — raise a new ADR (or amend the existing one, status `Superseded`) explaining why, referencing what changed.

## 8. Housekeeping

- Prefer squash merge; branches are deleted automatically on merge (configured at the repo level).
- Update the [glossary](docs/glossary.md) if a change introduces or renames a domain term.
- For UI-affecting changes, actually run the app and exercise the change (`/run`, `/verify`) before calling it done — passing tests isn't the same as the feature working.
