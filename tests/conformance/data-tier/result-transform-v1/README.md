# Result-transform v1 conformance corpus

This directory is the LLP 0051 D5 extension ruled by LLP 0157 OQ9 for
LLP 0166 §D7's dormant `result-transform.v1` evaluator. It follows the parent
data-tier corpus discipline: cases are committed data, the manifest hashes
every case, Rust-owned JSON Schemas close the case and manifest envelopes,
evaluator identities are pinned, and Rust/JavaScript compare exact RFC 8785
outcome bytes.

The committed corpus contains 56 version-1 cases. It covers base/page-chain
assembly, client-materialized overlay inputs, every filter operator, the total
scalar comparator, stable ties, the four required limit boundaries, composed
pipeline order, and typed out-of-profile refusals.

`clientOverlayRows` is the already materialized output of the client-only
optimistic layer machinery. Both reference runtimes consume those frozen rows
to verify the remaining transform exactly; the corpus does not pretend that a
server can execute arbitrary client callbacks. The JavaScript package test
separately composes real callback layers in owner order before invoking the
same pure transform.

## Files and runners

- `corpus-source.mjs` authors the cases; the committed `*.case.json` files are
  the cross-language contract.
- `corpus.manifest.json` binds the 37-case parent baseline, v1 compatibility,
  evaluator identities, per-case SHA-256, and `TransformHashV1`.
- `packages/snapback-client/result-transform.test.mjs --write` regenerates the
  cases and manifest. Without `--write`, it is the drift gate and JS runner.
- `crates/snapback/tests/result_transform_corpus_v1.rs` is the Rust runner.
- `schemas/result-transform-v1.{case,corpus}.schema.json` are generated from
  the Rust envelope types with `snapback-schemagen`.

This corpus passing does not admit evaluation. No store or live path imports
the evaluator; LLP 0166's every-carrier corpus/oracle gate and per-plan owner
reclassification to `result-transform-snapshot-v1` remain required.
