# 0080: root-window-v1 evaluation across evaluators + result encoding + cursors

**Status:** Resolved (2026-07-25) — residuals redirected below
**Severity:** P2
**Systems:** Query planning, Storage, Client integration
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0080 §2
**Marker:** step5-impl

Implement the normative pipeline (visible root filter → cursor boundary →
root order → take N roots → join + joined visibility → projection) in the
pure evaluator, SQLite, and the buffered read-your-writes overlay; take
bounds consumed authorized roots; continuation from the last consumed root
(all-omitted windows progress, take:0 and end-of-stream as pinned); opaque
versioned cursors with the pinned binding and the six refusal classes;
`RelationalResultEncodingV1` with golden vectors; machine-readable
capability gaps for targets that cannot execute a plan. Retained/native and
hosted evaluators follow the same normalized plan per the pinned manifest.
L-sized.

**Progress (2026-07-25, slice 4 — cursors landed):** opaque versioned
cursors are implemented end to end on the SQLite arm: `sbrc1` wire family
MAC'd with the resume keyring under a dedicated domain
(`src/rqs.rs` `RelationalCursorBody`/`mint_relational_cursor`/
`decode_and_verify_relational_cursor`), binding digest over
{app, plan, non-cursor args, order schema, authority partition =
auth fingerprint + permission-scope epoch}; keyset boundary lowering with
NULLS LAST/`_id` totalization (`src/storage.rs` `KeysetAfter`,
`build_keyset_after_sql`, always-total root ordering); continuation
semantics exactly as pinned (consumed-roots accounting, all-omitted
windows progress, short page terminal, take:0 empty); the continuation
rides `QueryOutput.cursor`; all refusal classes collapse to one
byte-identical `SNAPBACK_RELATIONAL_CURSOR_INVALID` (400), mint failure
fails closed with `SNAPBACK_RELATIONAL_CURSOR_MINT_UNAVAILABLE` (503).
The implicit `cursor` argument is on the authoring/contract surface and
the guide page documents the pagination contract. Witnesses:
`relational_keyset_pages_without_skip_or_duplicate`,
`keyset_lowering_totalizes_nulls_and_tiebreak`,
`relational_cursor_pages_and_refuses_end_to_end`.
**Progress (2026-07-25, slices 5-6 — resolved):**
`RelationalResultEncodingV1` landed (`src/rqs.rs`
`relational_result_encoding_v1`, committed golden vectors at
`schemas/relational.result-encoding-v1.json` generated through the encoder
and drift-gated; exact bytes pinned by
`relational_result_encoding_v1_pins_golden_bytes` and the executor
witnessed by `relational_rows_encode_under_result_encoding_v1`).
Evaluator-arm parity on the local target: the write lane and lock-free
read lane share one implementation — identical result bytes and
cross-lane cursor interchange witnessed by
`relational_lanes_share_bytes_and_cursors`; the buffered
read-your-writes overlay is witnessed unreachable by construction
(`relational_plans_cannot_enter_the_buffered_overlay` — ctx.db admits
only single-table plans, so §2's buffered arm is satisfied without a
second evaluator); the §2 concurrent-mutation bound is witnessed by
`relational_keyset_bound_survives_concurrent_mutations`. The retained
live re-run path executes relational plans through the same dispatch;
retained *stored-bytes* surfaces refuse relational plans (retention is
the 0080-live ticket's scope), and hosted targets report the
`relational_query_v1` capability gap.

**Residuals (redirected):** cross-target byte-identity through hosted
evaluators and the instrumented index-served bound fixtures belong to
`20260724-step5-impl-0080-acceptance-corpus.md`; retention
(`opaque-authorized-snapshot-v1`) and live/0053 inheritance belong to
`20260724-step5-impl-0080-live-0053.md`. A Sessions-mode session-axis
stale-authority case belongs to the conformance suite's auth-mode
matrix.

**Progress (2026-07-24):** slice 1 landed — `RelationalQueryPlan` closed
manifest types (manifest.rs) and the SQLite `root-window-v1` executor
(`LocalDatabase::query_relational`, one pinned read snapshot): visibility
before take, per-root unique-joined lookup with null-never-matches, inner
omission without refill, left null leaves, take:0, duplicate-unique-key
refusal, closed-shape refusals; witnessed by
`relational_root_window_semantics` incl. below-constraint duplicate
injection. Remaining: cursor issue/validate + `RelationalResultEncodingV1`
bytes, buffered-overlay and pure-matcher parity, hosted path, and the
codegen authoring surface (`defineRelationalQuery`) wiring plans into
FunctionRuntime with capability gating.
