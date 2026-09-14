# Snapback 4: `_ops` replay returns a mutation's cached `result` and `E_CONFLICT.current` without re-checking read authority

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: at-most-once replay (`_ops`), the `/m` wire, the refusal envelope
Observed version: main at `4e8e3efefeac6e313d40e5556c45d378b4fdb807`
Evidence status: reproduced and covered by simulator and real `/m` regressions in Lane W; original finding from the GPT-family blind review of LLP 3000.007 (`llp/reviews/3000.007-write-authority-and-page-pass.gpt.md`, concern 5)

## Problem

A mutation applies at most once per client-minted id: the engine records
the whole `MutationOutcome` in `_ops`, including `result` and a conflict's
`current` row image, and a resend returns the recorded outcome with
`replayed: true` without re-evaluating the caller's read authority
(`crates/snapback4-core/src/engine/mod.rs:683` and `:803`, `store.rs:416`,
`crates/snapback4/src/serve.rs:759` at the baseline). A result or conflict
image that was readable at the original attempt can therefore be retrieved
after the caller's access is revoked, including when the original response
was lost, and a different principal that reuses the same operation id must
be shown to get nothing. The reviewer notes this is an existing replay gap
independent of LLP 3000.007's proposals.

## What to establish

1. Whether `_ops` should keep a durable execution receipt (`sent`/`failed`,
   `seq`) separate from permission to retrieve cached content, with the
   content re-authorized (or not retrievable) on replay; or whether
   historical result retrieval is an intentional exception to be declared.
2. Regressions the review names: `wa5_hidden_write_replay_returns_only_sanitized_receipt`
   and `wa5_revoked_result_and_conflict_current_are_not_retrievable`, covering
   a dropped original response and a different principal reusing the same
   operation id.

## Context

Filed while the blind review's second family (Grok) was still running; the
disposition of the review as a whole is recorded in LLP 3000.007.

## Resolution — 2026-09-13, Lane W

`MutationOutcome::reply` in
`snapback4/crates/snapback4-core/src/engine/receipt.rs` is now the shared
serializer for `/m` and `_ops`: the durable record is exactly the original
viewer-facing body, without internal `metered`, `tables`, or event fields.
`Engine::replay` reconstructs only an execution receipt. Every replay omits
`result` and `current`, including scalar results, even if the original reply
was dropped. Historical read content is not retrievable; the caller uses a
fresh authorized query. Operation ids remain scoped to the original principal.

Proof: `wa5_hidden_write_replay_returns_only_sanitized_receipt` and
`wa5_revoked_result_and_conflict_current_are_not_retrievable` in
`snapback4/crates/snapback4-sim/tests/write_authority.rs`; the latter covers
revoked row results, scalar results, conflict current, dropped originals,
and a different principal reusing the id. The real HTTP counterpart is
`write authority: /m replay keeps only execution identity after hidden writes,
dropped replies and revocation` in
`snapback4/packages/snapback4/test/write-authority.test.mjs`. These tests
compare the complete receipt and verify that no retry repeats effects.
