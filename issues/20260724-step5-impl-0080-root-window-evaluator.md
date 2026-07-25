# 0080: root-window-v1 evaluation across evaluators + result encoding + cursors

**Status:** Open
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
**Remaining here:** `RelationalResultEncodingV1` + golden vectors;
buffered/pure evaluator parity plus the concurrent-mutation no-skip bound
witness; the retained/lease arm deliberately drops cursors
(decode-only snapshots). A session-identity partition transition is
witnessed via the permission-epoch roll; the dev-admitted path
canonicalizes sessions away, so the session-axis case belongs to the
conformance suite's Sessions-mode matrix.

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
