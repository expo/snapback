# Charter — fix the three MATERIAL candidate-review findings

You are a FRESH Codex fixer (you wrote neither the candidate code nor the
review). **You do not commit.** Use apply_patch. Never run
git commit/push/rebase.

Input: REVIEW-CANDIDATE-r1.md in this directory — three MATERIAL findings
with anchors and fix shapes, bound to febdafcca (this branch's tip). The
binding design documents are in the tree (LLP 0238 D1, LLP 0244 D1, and the
existing settlement retention contract per LLP 0218/0043).

Implement all three fix shapes exactly as scoped by the review:

1. Kind gate (packages/snapback-client/reference-kinds.mjs + tests):
   compatibility null ONLY for string references; every non-string object
   with absent/unknown/malformed kind throws
   SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH before name validation or
   transport, with a payload-safe skew/upgrade repair when no correct verb
   is knowable. Tests: missing-kind, future-kind, malformed-object for every
   transport-capable verb, asserting zero transports.
2. Proof binding (src/runtime.rs, src/local.rs, src/storage.rs): mint the
   closed proof-binding record from the prepared invocation/request carrier
   (process epoch, invocation nonce, principal + authority instance,
   function/artifact generation, result-contract hash, pinned snapshot,
   request/client-mutation identity); carry the independently trusted
   expected binding to the single storage commit boundary and compare
   BEFORE OCC admission/egress; dry-run preview borrows rather than clones;
   take-once retained. Adversarial tests: cross-request, cross-principal,
   cross-function/generation, retry, cancellation, same-id-winner.
3. Settlement accounting (src/storage.rs, src/storage/settlement.rs): one
   versioned logical retained-row byte formula used identically at
   insertion admission, counter reconstruction, acknowledgement, and
   authority-wide collection, covering settlement_format, the record
   sequence, and settlement_projection_seal_json, with an explicit
   migration/rebuild rule for existing counters. Tests: legacy/plain/media
   mixed rows; insert-then-ack returns global and per-authority counters to
   exact predecessor values across reopen/rebuild.

Do not change any accepted-document text. @ref new invariants. Run and
report verbatim: the new/affected node suites; cargo test for the affected
modules (runtime media provenance, storage media acceptance, settlement
tests); ./ref-check --verbose. Do NOT run the full rotation.

Report (REPORT-fixround.md): per-finding implementation summary, tests +
exact counts, deviations.
