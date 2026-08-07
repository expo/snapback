# `local-store-carrier-receipt` is stale on `main`

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Systems:** Testing, Packaging, Storage
**Date:** 2026-08-06
**Drift gate:** `local-store-carrier-receipt`
**Related:** `issues/20260806-main-red-agent-safe-leaf-set-drift.md`,
`issues/20260806-commands-profile-blocks-all-metrology-writers.md`,
LLP 0166 (local persistent store), LLP 0175 (local-proof economics)

## Summary

`node tests/acceptance/local-store-carrier-exit-v1.mjs --check` fails on `main`
with an `ERR_ASSERTION` referencing `packages/snapback-client/index.mjs`. The
carrier records are stale against the sources they pin:

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`

Same shape as the other drift found today: a landing changed a source the
carrier pins without refreshing the carrier in the same change.

## How it was found

By the drift-prone gate enforcement (LLP 0175) *before that enforcement
landed* — its own pre-push sweep refused the landing and named this gate. 13 of
14 gates passed; this one did not. That is the mechanism working as intended on
its first real use.

Note for whoever picks this up: the gate has two modes and they fail
differently. `--check` reports the real drift. Running the script **without**
`--check` attempts a full regeneration and needs a built server binary, failing
with `SNAPBACK_CARRIER_EXIT_SERVER_BINARY_MISSING` in a fresh worktree — an
infrastructure error that looks like a different problem entirely. Diagnose
with `--check`.

## Fix

Regenerate via `node tests/acceptance/local-store-carrier-exit-v1.mjs` (the
full run, which needs a bootstrapped runtime and produces the carrier-exit
evidence). This is an evidence-bearing regeneration, not a mechanical record
refresh, so it wants an owner who can attest the run rather than a drive-by
regeneration — which is why it is filed rather than fixed inline here.

## Blocking note

While this is stale, any push touching the carrier's pinned sources is refused
by the pre-push hook. That is correct behaviour, but it means this should be
cleared promptly. The loud bypass exists for pre-existing drift of this kind
and the main-side backstop will keep it visible.
