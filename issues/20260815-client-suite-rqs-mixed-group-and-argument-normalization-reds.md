# Client suite: two untracked deterministic reds — 0157-A3 mixed-group and stranded-recovery normalization

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Client SDK, Package tests
**Date:** 2026-08-15
**Related:** `issues/20260815-client-tests-construct-kindless-generated-references.md`
(the other three client-suite reds — same suite run, different signature)
**Found while:** LLP 0218 P6 deprecation-closure baseline verification
(`issues/closed/20260810-llp-0218-p6-deprecation-closure.md`)

## Problem

The full client suite (`node --test packages/snapback-client/*.test.mjs`)
carries five deterministic failures at clean `main`. Three are the
reference-kind fixture staleness already tracked in the related ticket. The
other two carry distinct signatures and were untracked until now:

- `packages/snapback-client/mixed-route-v2.test.mjs` —
  `0157-A3 byte-identical plans classify only from bound liveness` fails with
  `SNAPBACK_RQS_MIXED_GROUP_INVALID` in an unchanged fixture path.
- `packages/snapback-client/outbox-custody.test.mjs` —
  `stranded recovery reads, discards, and rerecords as a new current intent`
  fails with `SNAPBACK_ARGUMENT_NORMALIZATION_FAILED` before the test can
  assert the returned status.

Verified byte-identical (same names, same counts: 482 pass / 5 fail) at
`245f23518` and again on the merged tree at `d00b435ff` during the P6
closure on 2026-08-15, in a hermetic worktree with a fresh
`bun install --frozen-lockfile`. These predate and are unrelated to the P6
alias removal (`163682445`).

## Desired outcome

Diagnose whether each is a stale test fixture overtaken by newer enforcement
(the pattern of the related reference-kind ticket) or a product regression,
then fix the fixture or the product accordingly. The client suite should
return to 0 fail once this and the related ticket close.

## Acceptance

- Both named tests pass in a full-suite run at clean `main`.
- The resolution records which side (fixture vs product) each failure was.
