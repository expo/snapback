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
