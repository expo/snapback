# Familiar `v.doc` needs one-pass generation and runtime parity

**Status:** Closed
**Opened:** 2026-08-20
**Resolved:** 2026-08-21
**Landing SHA:** TBD
**Systems:** Familiar authoring, Code generation, Result contracts, Runtime
**Related:** LLP 0253; LLP 0277 P18; LLP 0295; Diary 0093

## Problem

The published Familiar profile exhibits two phase disagreements:

1. a function returning `v.doc("profiles")` cannot bootstrap from a clean
   checkout until schema-only generation has run first; and
2. a mutation document result can pass codegen and then fail the runtime
   result contract.

The lane repeatedly generated schema first and preserved/reseeded sessions
stores around corrections. Both failures look like application contract bugs
even though the authoring shape was admitted earlier in the pipeline.

## Requested repair

- Make clean-checkout generation resolve document types from the schema in the
  same invocation, or emit a stable phase-specific refusal before output.
- Make every result shape admitted by Familiar lowering admissible by runtime
  validation with the same effective contract; otherwise reject it at codegen.
- Add clean first-generation and query/mutation/action parity fixtures for
  single and array document results.

## Exit

One `snapback generate` on a clean Familiar app succeeds, and no generated
`v.doc` result fails solely because a later runtime phase interprets it
differently.

## Resolution

Familiar lowering now admits the same query/live-query `document` and `value`
result kinds as LLP 0108's runtime carrier, while mutation/action document
composites continue to refuse before activation output with
`SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` and the explicit-result rewrite.
The typed headless one-shot query, live handle/callback, and React client
surfaces project the internal one-row carrier to the authored single value.

Buffered runtime documents now include a structurally valid, handler-visible
`_version` under a commit-time allocator fence. If a disjoint mutation advances
the global version after handler execution, the stale invocation conflicts
before applying any effect; a successful invocation's observed, returned, or
persisted value therefore equals its authoritative commit version. For an exact
document result contract, settlement additionally replaces `_version`,
`_createdAt`, and `_updatedAt` from the matching document in the transaction's
final row image before retention or publication, then revalidates while
rollback remains possible. This includes unchanged rows and refuses a deleted
or missing final row rather than copying a delete preimage. Mutation dry-run
carries the same version fence and frozen result-contract identity through its
rollback path and applies the same projection and revalidation before forming
`DryRunReport.result`.

An exact published-0.1.24 scratch install reproduced both defects. Clean first
generation returned `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID` with
`profiles.readOne: Query cannot use value result contract` before activation
output. The mutation's document contract then generated successfully but the
native mutation failed with
`SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` at `$._version` and constraint
`requiredField`; this is the runtime regression covered by the settlement
tests.

## Evidence

- `node --test packages/snapback-codegen/inline-result-contracts.test.mjs packages/snapback-codegen/familiar-phase-b.test.mjs` — 11/11 passed.
- `node packages/snapback-client/package.test.mjs` — passed, including direct,
  nullable, and malformed single-value query carriers.
- `cargo test -p snapback-engine structured_value_survives_the_handler_read_your_writes_overlay -- --nocapture` — passed; the dry-run result equals its predicted changed row, is discarded, and the committed result equals the stored row.
- `cargo test -p snapback --test dry_run_v0 -- --nocapture` — 7/7 passed through the public `mutationDryRun` surface.
- `cargo test -p snapback-engine batch_unique_many_overlays_buffered_insert_and_duplicate_keys -- --nocapture` — passed; buffered inserts expose their fenced commit successor.
- `cargo test -p snapback-engine copied_insert_version_conflicts_after_disjoint_commit_then_matches_fresh_commit -- --nocapture` — passed; a disjoint commit moves the allocator from 1 to 2, the stale invocation rejects with `commitVersionFence` before either insert lands, and a fresh invocation returns and persists exactly version 2.
- `scripts/bootstrap-ibex-runtime` — recovered and stamped the lazy Ibex/Hermes
  artifacts, then refused its duplicate clean-link probe after the stable
  900-second `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`; focused Cargo compilation
  subsequently completed without a product compile error.
- `cargo build --locked --bin snapback` plus `runtime-readiness.mjs
  issue`/`verify` — rebuilt `target/debug/snapback` in this worktree and
  qualified its restricted no-eval handler VM; the refreshed packed candidate
  binary digest was
  `61cd198659ca90e9e6dd7f24a1eeeb2d0316753397becd8d60a2139d15bf1c3e`.
- `SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback
  node scripts/familiar-vdoc-vertical-contract.mjs` — packed seven-package
  closure passed from a fresh external app: Guide spelling, clean one-pass
  bare-`v.doc` generation, typecheck, native query/mutation/action acceptance,
  headless one-shot/live and React projection, present/absent/delete live
  transitions, byte-preserving refused CLI regeneration, and stable clean
  pre-output mutation/action array refusals.
