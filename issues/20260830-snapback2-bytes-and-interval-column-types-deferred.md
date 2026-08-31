# snapback2: `Bytes { max }` and `Interval { of }` column types are deferred behind a value-model decision

**Status:** Open
**Systems:** snapback2, schema, evaluator
**Severity:** P3
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1001 §9, `issues/20260829-bounded-programs-column-type-survey.md`, LLP 0329.015 K5, Diary 0114

The column-type survey ranked four types; `Enum` and `Decimal { scale }` (+ `Money`) landed in LLP 1001 §9 because both fit today's value model (`Value::String` / `Value::Int` of minor units). The other two do not:

- `Bytes { max }` needs a `Value::Bytes` variant, a canonical JSON encoding shared byte-for-byte with the TypeScript twin (the 75-case corpus is the contract), an index-key encoding, and a value-model version bump in every certificate. Diary 0114's 32 KiB base64 ceiling is the shipped incident it fixes.
- `Interval { of }` (four archetypes needed membership-at-a-time, LLP 0329.015 K5) interacts with visibility (interval rules), retention, and the deferred `exclusion` constraint; it is semantics, not a type.

Do `Bytes` first (mechanical, corpus-verified), then `Interval` with its own LLP. `Duration` and `Set { of, max }` ride along with whichever makes them cheap.

## 2026-08-30 — Bytes half resolved

`Bytes { max }` is implemented across the Rust value/schema/runtime surfaces,
the TypeScript compiler, and the evaluator twin. Values use the canonical
tagged lowercase even-length base16 JSON form `{"Bytes":"007f80ff"}`; `max`
is a byte-length bound enforced on insert and update through the existing
`E_INPUT` write-refusal family. Bytes indexes use the existing tagged scalar
key style and preserve unsigned lexicographic byte order.

The certificate value model moved once from `i53-codepoint-v1` to
`i53-codepoint-bytes-v2`. All 76 prior corpus cases now persist a certificate
snapshot at that version, and four cases were added for round-trip,
write-bound refusal, byte-index order, and Rust/twin canonical serialization
(80 total). A pre-/post-change binary comparison found no certificate change
outside `value_model_version`; the prior case inputs, receipts, expected
states, closures, labels, and magnitudes are otherwise byte-identical after
the newly persisted certificate field is removed.

The review-fix round made the externally tagged form exact on the engine,
twin, and seed authoring gate; made rule literals produce Bytes only when a
Bytes schema position supplies the expected type; and turned the shared
`i53-codepoint-bytes-v2` value-model version into a consumption gate. Compiler
descriptor maxima now stop at the Rust IR's representational ceiling
`u32::MAX`; this is not a new product-level size cap, because the existing
program ceilings already price impractically large declarations through the
`E_BOUND` family.

`Duration` and `Set { of, max }` did not ride along: Duration needs a unit-aware
compiler/type contract, while Set needs canonical uniqueness and ordering
semantics; neither is a near-free extension of Bytes. This ticket remains
**Open** for `Interval { of }` (which still requires its own LLP), Duration,
and Set.

**Claim retracted** (session snapback-8a, 2026-08-30): the 0830 burn's `s2/t-bytes` lane landed the Bytes half before this claim was pushed; lane `s2/t2-bytes` was cancelled with no commits. Only the provenance/site ticket remains claimed by snapback-8a.
