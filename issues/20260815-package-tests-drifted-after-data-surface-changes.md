# Three package suites are red from stale post-data-surface expectations

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Client SDK, Codegen, React, Package tests
**Date:** 2026-08-15
**Governing:** LLP 0255, LLP 0218, LLP 0041
**Related:** `issues/20260815-artifact-schemas-v0-committed-output-drift.md`
**Found while:** Whole-codebase correctness review (2026-08-15)

## Problem

Isolated package runs reveal three deterministic reds after recent surface
changes. These are not the shared-fixture races produced by running all package
suites concurrently:

1. `packages/snapback-codegen/generated-mutation-ir.test.mjs` expects an
   `authUserId()` insert to be `server-only`, but codegen reports
   `local-executable`. Commit `c9b158d95` deliberately removed `AuthUserId`
   from `GENERATED_LOCAL_MUTATION_AUTHORITATIVE_EXPRESSIONS_V1` without updating
   this frozen expectation. The governing prediction/custody reason must be
   made explicit, then either code or test corrected.
2. `packages/snapback-client/diagnostic-error.test.mjs` expects an offline
   `queue:"auto"` mutation to resolve queued while its mock makes the target
   capability probe fail offline. The current settlement-ledger gate correctly
   refuses to queue without a positive target capability, so the test no longer
   reaches the behavior it claims to cover.
3. `packages/snapback-react/familiar-types.fixture.ts` imports
   `tests/fixtures/familiar-todo{,-explicit}/generated/api.d.ts`, but those
   generated declarations are absent. TypeScript then also reports the related
   `@ts-expect-error` directives as unused.

The first two stop their package scripts early; the React suite runs its runtime
tests and then fails its final type fixture. This leaves package-level changes
without a trustworthy green local proof.

## Desired outcome

Repair the fixtures at their semantic owners: pin the intended `AuthUserId`
prediction rule with an LLP reference, give the queue test a positive
settlement-ledger capability before simulating transport loss, and make the
familiar type fixtures hermetically generate or consume committed outputs.

## Acceptance

- `bun run test` passes independently in `packages/snapback-codegen`,
  `packages/snapback-client`, and `packages/snapback-react`.
- The codegen test still catches accidental admission of genuinely
  authoritative expressions.
- The client test proves both capability-positive queueing and
  capability-absent refusal.
- React type coverage works from a fresh clone without a hidden prior codegen
  run.

