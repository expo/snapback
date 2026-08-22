# `check-inventories` is enforced by convention only — no hook, no CI job runs it

Status: Open
Created: 2026-08-21
Related: CLAUDE.md ("Landings that add test files, metadata-declared demos, or generated
publication leaves run `node scripts/check-inventories.mjs` before pushing")

## Evidence

Main went red on `check-inventories` **three times on 2026-08-21**, from at least three different
landings:

- twice on stale diagnostics projections (`guide/reference/diagnostics-registry.json` and its
  guide projections), including once by me;
- once on `package-test`, when three `authority-transition-*` suites landed wired into their
  packages' `pretest` scripts but unregistered in the package-test inventory.

That is not three careless landings. It is a gate with no mechanical backstop.

## What actually runs

`scripts/check-inventories.mjs` — the checker that validates real repository state — is invoked by:

- **no git hook.** `.githooks/pre-push` selects frozen-record drift gates only; it contains no
  reference to inventories.
- **no CI workflow.** No file under `.github/workflows/` references it.

The only automated thing in the vicinity is `tests/check-inventories.test.mjs`, which is a unit
test of the checker's *logic*. It is run by the `test:maturity` package script and by
`scripts/verify-local-proof` (line ~512). Neither runs the checker against the working tree, so a
stale registry or an unregistered test file passes both.

Additionally: `core.hooksPath` was unset in at least one working clone, so even the drift hook was
not running there. CLAUDE.md documents `git config core.hooksPath .githooks` as a setup step, and
a clone that skips it gets no pre-push gates at all, silently.

## Why it keeps happening

The failure is invisible at authoring time. The diagnostics registry stores absolute line numbers,
so *any* edit to a large file such as `engine.rs` restages ~1400 lines of projection for no
semantic change (tracked in `issues/20260821-diagnostics-registry-tracks-line-numbers.md`). An
author who does not already know the rule has no signal, and an author who does know it has to
remember it on every landing that touches a file with diagnostic emissions — which is most of them.

## Proposal

1. **Add `node scripts/check-inventories.mjs` to a CI workflow.** Cheapest complete fix: it is a
   fast, deterministic, docs-and-registry-only check. Red main becomes impossible to merge rather
   than discovered minutes later by whoever pushes next.
2. **Add it to `.githooks/pre-push`** alongside the drift gates, so it fails locally before the
   push rather than after. It should follow the existing deferred/strict posture rather than
   introducing a new blocking mode.
3. Consider making `core.hooksPath` verification part of a doctor script, so a clone without hooks
   reports that fact instead of silently skipping every pre-push gate.

Item 1 alone would have prevented all three of today's reds.

## Note

Fixing forward has been fine each time — the regeneration is mechanical. The cost is that main sits
red between the landing and whoever notices, and every concurrent agent that pulls in that window
sees a failing gate it did not cause and has to diagnose it before its own work.
