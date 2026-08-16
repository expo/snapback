# Client tests still construct generated references without `artifactKind`

**Status:** Closed (2026-08-15)
**Impact:** 2
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Client SDK, Package tests, Generated references
**Date:** 2026-08-15
**Governing:** LLP 0238 (reference-kind admission)
**Related:** `issues/closed/20260815-app-cli-selectors-omit-reference-kind.md`
(the packaged-CLI construction site, fixed 2026-08-15)
**Found while:** Supervised 2026-08-15 ticket-fix run (jsdata/jspack lane baseline verification)

## Problem

Since the canonical client began requiring generated references to carry
`artifactKind`/`kind`, at least two client package test files still construct
bare references and fail deterministically at clean `main` `a93a11235`
(verified in an untouched worktree with a fresh `bun install`):

- `packages/snapback-client/auth-anonymous-read-recovery.test.mjs` — three
  subtests fail with `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH: query received
  a missing generated reference kind` (chain-visible; stops the package run).
- `packages/snapback-client/outbox-custody.test.mjs` — same class when run
  standalone.

These are stale test fixtures, not product regressions: the enforcement is the
intended LLP 0238 behavior and the packaged-CLI construction site was fixed
separately.

## Desired outcome

Update the test fixtures to construct closed generated references (exact
`artifactKind: "functionReference"`, title-case `kind`, generation identity)
the way codegen publishes them — ideally through a shared test helper so the
next reference-shape evolution has one place to update. Audit the client
package for any remaining kindless constructions in the same pass.

## Acceptance

- `bun run test` in `packages/snapback-client` passes from a fresh clone.
- Deliberate kind-mismatch coverage (wrong verb/kind refusals) is preserved.

## Resolution (2026-08-15)

Fixture-side, as suspected. `auth-anonymous-read-recovery.test.mjs` now
constructs closed generated references with `artifactKind:
"functionReference"` and title-case `kind`; `outbox-custody.test.mjs`
additionally needed the closed `argumentSchema` the argument-normalization
path now requires (its red was tracked in the sibling ticket). Deliberate
wrong-kind refusal coverage is preserved. Full client suite green at clean
main + this change. Landed with the LLP 0258 lane A2 salvage.
