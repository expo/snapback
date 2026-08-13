# Candidate review — round-2 delta

## Provenance

- **Model:** OpenAI Codex, GPT-5.6-sol, xhigh reasoning
- **Review date:** 2026-08-12
- **Candidate HEAD:** `2de8e458e4cb9ee2c1e1e0834f0944941c2ae8c0`
- **Round-1 base:** `febdafcca0d20940780879a79e9aae3ce768aeaa`
- **Blindness:** Fresh independent delta reviewer. I wrote none of the candidate code, the round-1 review, or the fixes. I used `REVIEW-CANDIDATE-r1.md` only as the required finding list and derived the conclusions below from the candidate tree, governing LLPs, the complete `febdafcca..HEAD` delta, and direct verification.

## Scope and verification

I verified the exact required HEAD, reviewed every commit and changed file in `febdafcca..HEAD`, and traced the three repairs through their production callers and focused tests. I also checked the governing constraints in LLP 0000, LLP 0238 D1/D8, LLP 0244 D1/D4/D6, LLP 0043, LLP 0225, and LLP 0133.

Focused verification passed for the reference-kind tests, the complete client outbox-store suite, the client package test, the Rust proof-binding test, the Rust mixed-settlement/rebuild test, `git diff --check`, `./ref-check --verbose`, and `node scripts/check-guide.mjs`. A separate production-class outbox probe exposed the replay regression described below.

## Round-1 finding closure verdicts

### MATERIAL 1 — CLOSED AS REPORTED

The public kind gate now preserves compatibility only for string references. Non-object, missing-kind, unknown-kind, and malformed-kind references are distinguished and refused with `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH` before transport; the new matrix exercises those cases across all five public verbs, asserts zero transports, and checks that diagnostic data does not expose the submitted object.

This closes the round-1 bypass at the public boundary. It also exposes a new internal caller regression, reported separately below rather than counted as a failure of the gate itself.

### MATERIAL 2 — NOT CLOSED

**Anchor:** `src/runtime.rs:409-419,517-539`; `src/auth/invocation.rs:1646-1651,2003-2005`; `src/manifest.rs:3792-3810,7773-7774`; `src/local.rs:12830-12871,21943-22001`; coverage gap at `src/storage/tests.rs:17374-17446`.

The repair correctly replaces the cloneable carrier with one owned proof, makes preview borrow it, makes commit consume it, and compares an independently reconstructed binding at `src/storage.rs:4011-4022` before OCC admission. The record is nevertheless not closed over the facts claimed by the fix:

- `function_artifact_generation` remains `Option<String>`, is copied from optional `implementationHash`, and manifest validation only validates a hash when present. A media-bearing function may therefore reach this boundary with no generation fact, and proof and expected binding compare equal at `None == None`.
- `client_mutation_identity` also remains optional and is reconstructed only from `input.auth.client_mutation_digest`. In the covered action-hosted child path, the actual `ClientMutationIdentity` is minted separately (`src/local.rs:21943-22001`) and passed separately to storage (`src/local.rs:12855-12871`); the binding comparison does not compare that identity. Thus a proof can be admitted with both binding members `None` while the authoritative commit carries a concrete settlement identity outside the binding.

The adversarial test begins with `Some` for both members and only tests `Some(a)` versus `Some(b)`, so it does not exercise either absent-member collapse. The process/nonce/request members materially improve isolation, but they do not fulfill the required closed function-generation and client-mutation binding at the storage boundary.

**Required fix:** refuse media proof creation/admission unless a concrete function artifact generation is available, and bind the proof to the authoritative commit identity actually supplied to storage (using an explicit non-absent representation for lanes that genuinely have no client identity). Add `None`-collapse tests and an action-hosted child test that swaps the separately carried commit identity.

### MATERIAL 3 — CLOSED

The repair defines one v4 logical retained-row formula in `src/storage.rs:15711-15765` and uses it for reconstruction, insertion, acknowledgement, and authority-wide collection. The counter version is bumped to 4, and initialization rebuilds both global and per-authority counters when the stored version is stale. The mixed settlement test exercises a genuine pre-epoch predecessor row, migration/reopen, plain and media successors, forced v3-to-v4 rebuilds, acknowledgement back to the exact predecessor totals, and a second rebuild. The focused Rust test passed.

## New findings

### MATERIAL — IN-DELTA: generated outbox replay is terminally failed by the strict gate, and the new test double masks it

**Anchor:** `packages/snapback-client/index.mjs:7154-7157,8187-8191`; `packages/snapback-client/outbox-store.test.mjs:49-60,1742-1759`.

The production replay and stranded re-record paths reconstruct a generation-bound function reference as `{ name, expectedGeneration }` without `kind: "Mutation"`. The newly strict gate therefore refuses the SDK's own stored generated mutation before transport. In normal replay, the catch path treats that refusal as a terminal failure and removes the durable pending intent instead of delivering it.

A direct probe using the production `SnapbackClient` queued a generated mutation offline and then replayed it against a successful fetch stub. It produced `replayed: 0`, `failed: 1`, `remaining: 0`, performed zero transports, and stored `SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH`. The checked-in replay test passes only because `GeneratedMutationReplayClientDouble.mutate()` silently inserts `kind: "Mutation"` before calling the production method. That subclass changes the behavior under test and masks the production regression.

**Required fix:** include `kind: "Mutation"` in every internal generation-bound mutation reference, including replay and explicit stranded re-record, and exercise those paths with the production `SnapbackClient`. A valid durable generated intent must remain replayable and must not be terminally retired because the SDK reconstructed an invalid reference.

No other material delta concern was found. The development-exposure guard is scoped and restored by drop, the four authority-profile initializer changes are mechanical, registry regeneration is consistent with the changed inputs, and the remaining reference-kind test updates preserve rather than weaken their assertions.

VERDICT: MATERIAL FINDINGS
