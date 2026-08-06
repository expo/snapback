# JS handler reads silently truncate string fields at 16 KiB while storage holds full bytes

**Date:** 2026-08-05 · **Found by:** LLP 0183 Stage 0.5 control fixture load (Lane 1)

## Symptom

A `defineJsMutation` ingest stored a 44,084-char `comment.body` (verified in
raw SQLite: `select length(body)` → 44084). A `defineJsQuery` reading the same
row back received `body` clipped to exactly 16,384 chars — silently: no
diagnostic, no truncation witness on the result, the query reports success.

Repro (demos/zerobugs/control on worktree zerobugs-lane1, uncommitted):
- `scripts/build-fixture.mts` compiles the pinned Zerobugs ordinary seed; row
  `comment id=-Vjq...` (fixture index 886, `_id comment_56148931bc932776f00dceb6`)
  has a 44,084-char body (pinned Postgres cap is 64 KiB).
- `scripts/load-fixture.mts` ingests via `fixtureIngestBatch` (≤900-row
  batches) and reads back via `fixtureInspectTable`; digest verification fails
  with observed body length 16,384 vs compiled 44,084.
- Runtime binary: target/debug/snapback (gitCommit f8a7a1596, dirty).

## Why it matters

- Storage/write path is fine; the read path lies. Every JS handler consuming a
  string field ≥16 KiB computes on silently corrupted data — guards, patches,
  search documents, effect payloads.
- Violates the bounded-work contract everywhere it's stated (bounds must yield
  refusal/unknown/witnessed truncation, never a plausible truncation — LLP 0183
  design principle 7, and the runtime's own throw-metadata path carries
  explicit truncation flags for error text).
- The pinned Zerobugs workload legitimately carries comment bodies up to
  64 KiB, so the LLP 0183 control cannot pass ZB1 with this behavior.

## Suspected locus

`src/runtime.rs` value bridge: `ex_hermes_value_stage1_text` carries an
`out_truncated` flag and `SAFE_TEXT_MAX_BYTES = 16_384` is used for safe throw
metadata; something on the db-row→JS value (or JS value→result) path appears
to reuse a 16 KiB-capped text read without surfacing the truncation witness.
Not yet confirmed — needs tracing of the `ctx.db` row materialization and
result serialization paths for JS handlers.

## Located cause (Phase 1, 2026-08-05)

The stored-value path is full fidelity; the successful JS-result path is not.

- `src/runtime.rs:1615` materializes `ctx.db.query` output as an ordinary
  `serde_json::Value`; `src/runtime.rs:1630-1635` returns a `ctx.db.get` row
  unchanged. `snapback_host_call` then encodes that value as `+json` at
  `src/runtime.rs:3822`. Ibex's host-call decoder parses the complete JSON into
  the Hermes VM (`vendor/ibex/src/engine/hermes_runtime.cc:16120-16129`); that
  lane has no 16 KiB cap.
- The exact cap is in `packages/snapback-harness/ctx-bootstrap.js:1215-1258`:
  `SNAPBACK_FAILURE_EXTRACTION_MAX_BYTES = 16 * 1024` and
  `__snapbackSafeString` deliberately provide bounded failure metadata.
  `__snapbackJsonReplacer` at lines 1299-1301 incorrectly reuses that helper
  for arbitrary JSON strings, and the successful settlement serializer passes
  it to `JSON.stringify` at line 1312. Consequently every string anywhere in
  a successful query, mutation, or action result is silently clipped to
  16,384 UTF-8 bytes before Rust receives and validates the result envelope.
- `ex_hermes_value_stage1_text` and Rust's `SAFE_TEXT_MAX_BYTES` are not on the
  database/result value path. `src/runtime.rs:3292-3435` uses them only to
  inspect asynchronous-failure reasons, where the returned truncation flag is
  preserved explicitly.

Minimal generated scratch app:
`/tmp/snapback-js-string-repro.07S7Vh` (not committed). Its JS mutation inserts
a 44,084-character string and its JS query returns both the row body and
`row.body.length`. The generated app's in-process runtime run reported:

```json
{"expectedLength":44084,"handlerObservedLength":44084,"returnedLength":16384,"returnedExactly":false}
```

That witness proves the handler sees all 44,084 characters through `ctx.db` and
the shared settlement serializer clips only the returned string. A rebuilt
`target/debug/snapback` could not run the same app through the ordinary
headless server harness in this agent sandbox because loopback bind was denied
with `EPERM`; the generated manifests and exact embedded runtime path were
therefore driven through `LocalSnapback` without a listener.

## Required behavior (pick per governing LLP; do not silently truncate)

Either full-fidelity strings across the bridge (bounded by the declared field/
row ceilings, which admit 64 KiB+ bodies elsewhere), or a fail-closed refusal
with a stable diagnostic when a value exceeds the bridge bound. Silent success
with clipped data is not admissible.

## Resolution

Resolved 2026-08-05.

The handler harness had accidentally applied its deliberately bounded failure-
metadata JSON replacer to successful handler results. The replacer clips every
string to `SNAPBACK_FAILURE_EXTRACTION_MAX_BYTES` (16 KiB), so the full stored
row reached JS but the successful settlement envelope returned a plausible
prefix to Rust.

Successful settlement now serializes the handler value without the failure-
metadata replacer. The host's existing post-JSON result validator remains the
single owner of the declared 1 MiB-per-string and 4 MiB-complete-result limits.
This is the full-fidelity behavior required by LLP 0108
`#result-contract-vocabulary`; LLP 0108
`#runtime-validation-and-atomicity` requires the host to reject an invalid
query result before publication or invalid mutation result before commit.
Failure messages, stacks, and application-refusal details retain their bounded,
witnessed extraction path.

Regression coverage now includes both the direct Hermes result bridge and a JS
mutation/query roundtrip through `ctx.db`. The 44,084-character generated
scratch-app witness changed from:

```json
{"expectedLength":44084,"handlerObservedLength":44084,"returnedLength":16384,"returnedExactly":false}
```

to:

```json
{"expectedLength":44084,"handlerObservedLength":44084,"returnedLength":44084,"returnedExactly":true}
```

Verification completed with `cargo build --bin snapback`, the targeted direct-
bridge test, the full `handler_settlement_v0` suite, the harness envelope and
security tests, `./ref-check --verbose`, and
`target/debug/snapback runtime-qualify`. The rebuilt binary's ordinary server-
harness scratch run could not bind `127.0.0.1:0` in the agent sandbox (`EPERM`),
so the same generated schema/function manifests were driven through the exact
embedded `LocalSnapback` handler runtime to obtain the post-fix witness above.
