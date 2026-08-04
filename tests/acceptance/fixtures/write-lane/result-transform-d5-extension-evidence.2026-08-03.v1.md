# LLP 0051 D5 result-transform extension evidence

**Evidence date:** 2026-08-03  
**Scope:** lane P5's dormant `result-transform.v1` references and corpus only  
**Machine receipt:** `result-transform-d5-extension-evidence.2026-08-03.v1.json`

## Outcome

The LLP 0157 OQ9 ruling is implemented as a versioned subcorpus of LLP 0051
D5, not a standalone conformance family:

| Result | Count |
| --- | ---: |
| Extension cases | 56 |
| Exact successful outputs | 29 |
| Exact typed refusals | 27 |
| Client-materialized overlay inputs | 3 |
| Rust-vs-JavaScript exact JCS outcomes | 56 |
| Skipped, blocked, or unpinnable | 0 |

Every case pins its complete output row sequence or exact refusal code/reason,
its `TransformHashV1` (or literal `null` for a structurally invalid plan), its
case SHA-256, the profile/corpus version, and both evaluator identities. The
machine receipt adds one canonical-outcome digest per case and hashes the
implementation, runner, schema, and evidence sources.

## Semantics covered

The success cases cover requested-page and complete-page-chain assembly,
empty bases, overlay-only rows, overlay shadowing, every `basic-v1` filter
operator, conjunction, absent-as-null, mixed-type range comparisons, both
directions of the frozen type rank, boolean/numeric/unsigned-UTF-8 string
ordering, multi-key ordering, stable ties, limits 0/1/exact/over-size, and the
complete pipeline composition. A dedicated case proves filtering happens
before order-field scalar validation.

The refusal cases cover unknown stages and plan fields, an attempted comparator
selector, normalization, filter grammar/operator extensions, empty `in`,
duplicate order fields, negative/fractional/unsafe limits, cross-address keys,
unprojected fields, non-scalar operands/fields, mixed versions, broken/empty
page chains, non-row results, missing overlay input, missing plan fields,
unknown directions/overlay modes, and non-record rows.

## Overlay boundary

Corpus `clientOverlayRows` are the already materialized output of the existing
client-only optimistic layer machinery. Both references consume those same
rows so filter/order/limit and output bytes remain comparable. The JavaScript
suite separately executes real callback layers in owner order, verifies
overlay-only and shadowed rows, and proves contextual refusal happens before a
callback can run. The Rust reference never executes a client callback.

## Artifact and wiring posture

The Rust and JavaScript modules are pure. The JS file is browser-safe (no
`Buffer`, no static `node:` import, WebCrypto fallback) and deliberately absent
from the package export/file lists. No store, evaluation-floor, package root,
or live path imports either evaluator. The Rust-owned corpus case/manifest
envelopes generate the two committed JSON Schemas; this is artifact shape
authority, not a capability claim.

## Verification record

Observed in this checkout on 2026-08-03:

```text
scripts/bootstrap-ibex-runtime
  SNAPBACK_IBEX_RUNTIME_LINK_OK; restricted no-eval handler VM qualified

node packages/snapback-client/result-transform.test.mjs
  56 JavaScript cases exact; 3 tests passed, 0 failed

DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
  cargo test --locked --test result_transform_corpus_v1 -- --nocapture
  2 passed; 0 failed

DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
  node tests/acceptance/fixtures/write-lane/result-transform-d5-extension-evidence.2026-08-03.v1.mjs
  56/56 Rust-vs-JS exact; 29 success; 27 typed refusal; 0 skipped

cargo test --locked --test artifact_schemas_v0 \
  result_transform_d5_extension_envelopes_match_the_generated_schemas
  1 passed; 0 failed

cargo test --locked --test artifact_schemas_v0 \
  dk7_committed_schemas_match_rust_types
  1 passed; 0 failed

node scripts/check-package-test-inventory.mjs
  185 declared test files; passed

bash scripts/check-generated-artifacts
  passed; committed review manifests and projections current

./ref-check --verbose
  167 LLP docs; 3483 refs in 8574 files; 0 errors; 0 unchecked

git diff --check
  passed; no output
```

The requested full `@expo/snapback-client` command was also run with a fresh
`SNAPBACK_CLIENT_RQS_DIR`. The unchanged suite reached
`push-registry.test.mjs` after the package, Micro, and Micro operational tests,
then the sandbox refused its existing `server.listen(0, "127.0.0.1")` with
`EPERM` under Node v25.9.0 (command exit 1). The new in-process
result-transform suite passes independently and uses no socket. This is an
environment limitation, not recorded as green.

## Gate interpretation and remainder

This receipt satisfies lane P5's pure-reference/corpus evidence only. It does
not fire LLP 0166's ship gate. Evaluation remains dormant until the corpus is
green on every claiming carrier, the client-only S6 composition and remaining
admission/rotation oracle legs are green, and each participating plan owner
reclassifies the plan to `result-transform-snapshot-v1`, rotating node, plan,
materialization, and address identity with fresh establishment. Only that
follow-up may wire the evaluator into the store/evaluation seam.
