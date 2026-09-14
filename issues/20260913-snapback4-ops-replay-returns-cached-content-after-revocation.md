# Snapback 4: `_ops` replay returns a mutation's cached `result` and `E_CONFLICT.current` without re-checking read authority

Status: Open
Priority: P1
Date: 2026-09-13
Systems: at-most-once replay (`_ops`), the `/m` wire, the refusal envelope
Observed version: main at `4e8e3efefeac6e313d40e5556c45d378b4fdb807`
Evidence status: source-traced finding of the GPT-family blind review of LLP 3000.007 (`llp/reviews/3000.007-write-authority-and-page-pass.gpt.md`, concern 5); not yet reproduced by a test

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
