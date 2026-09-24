Lane A review round 1 corrections — 2026-09-24

Branch `sb4-intent/a-planner`, on top of `7dc85b6b7`. This report covers the six Astra findings supplied by the supervisor. Nothing pushed or published. It supersedes the earlier report's claims about the affected ordering, wrapped continuation and source-heap cases.

Changes, file by file (paths relative to `snapback4/`):

| File | Correction |
| --- | --- |
| `crates/snapback4-lang/src/bind/intent.rs` | Preserve the first occurrence of every requested order column, including an alias mapped to source `id`. Do not move that id behind subsequent order columns. Keep equality on a nullable order column as a residual instead of fabricating two invalid seeks. |
| `crates/snapback4-core/src/engine/pages.rs` | Derive projected merge page ownership from `ViewPosition.after`, including cursor aliases and pages wrapped in records. Ordinary merge ownership is unchanged. |
| `crates/snapback4-core/src/engine/runner.rs` | Track the scoped projected-source scan mode. This is interpreter state, with no serialized IR change. |
| `crates/snapback4-core/src/engine/view_merge.rs` | Enter and restore that mode around source scanning, including error returns. |
| `crates/snapback4-core/src/engine/read.rs` | Use the store's allocation ledger for projected source scans, including fetched buffers, key decode, optional-field materialization and retained scan vectors. Also charge all fetched source row bodies before filtering/projection; sharing an Arc cannot hide retained payload. |
| `crates/snapback4-lang/src/bind/program/views.rs` | Lower one-source, non-query views to the existing ordinary page loop plus projection. Keep the source scan's admitted bound and normal mutation visibility/expiry checks. Query views retain their shared view cursor descriptor. |
| `crates/snapback4-lang/tests/intent_review.rs` | Seven regression tests described below. |
| `crates/snapback4-device/tests/intent_views.rs` | Four additional device regressions, exercising memory and SQLite. |
| `crates/snapback4-sim/tests/reviews.rs` | Replace the masked non-unique-audience fixture with an isolated named-probe fixture. First assert that its unique form compiles; then assert that removing uniqueness reports `must be unique`. |
| `JOURNAL.md` | Append one entry with verification, measurements and scope. |
| `reports/20260924-intent-lane-a-review-1.md` | This correction and integration record. |

Corrected forms, all exercised in compiled runtime tests:

- `view v:` / `t { source: .id, at }`, followed by `v first 1 by .source, .at after c`. Rows `(a,3), (b,2), (c,1)` now paginate `a, b, c`; `last` returns `c, b, a`. A two-table case with coincident ids orders the following timestamp field correctly too.
- `return { events: v first 1 by .at after c }` carries the view's continuation and completes every page. A bound alias of `c` works as well.
- `view v:` / `t { id }`, followed by `v first 20`, charges full fetched source payload even though the projection omits `body`.
- `t where .at = null first 1 by .at after c` and its `last` variant compile and page only the null rows of `at: time ?`.
- A mutation may `return v where .owner = viewer` for `view v:` / `t { owner }` when the underlying synced table admits that capped scan. Removing its cap still refuses; non-uniform and expiring mutation scans still refuse.
- `read <- exists memberships[conversationId = .conversationId, principal = viewer]` with `sync to memberships[.conversationId]` still requires a unique audience index. The regression now reaches that validation directly.

New regression proofs:

| Test | What it proves |
| --- | --- |
| `id_alias_keeps_its_position_before_other_order_keys` | Ascending and descending one-row pages preserve an id alias before timestamp order, with no missing rows. |
| `id_alias_union_orders_equal_ids_by_the_following_field` | Two branches with coincident ids use the later timestamp key before branch identity, in both directions. |
| `wrapped_view_page_owns_its_shared_cursor` | A record-wrapped view page, with a bound cursor alias, owns its continuation through exhaustion. |
| `view_charges_source_rows_even_when_projection_drops_the_payload` | Both direct and id-only projected reads of 20 one-megabyte rows hit heap, clear their result and expose no continuation. |
| `ordered_nullable_equality_remains_an_exact_predicate` | Null equality plus explicit nullable order compiles and remains exact across pages in both directions. |
| `single_branch_view_preserves_mutation_scan_admission` | A capped private synced source and its view return the same authorized row in mutations; removing the cap refuses. |
| `single_branch_view_does_not_relax_mutation_visibility_or_expiry` | The source and view both retain the mutation refusal for non-uniform visibility and expiry. |
| `ordered_wrapped_view_memory`, `ordered_wrapped_view_sqlite` | The ordering and ownership fixes survive sync and device reopen on both stores. |
| `view_source_heap_memory`, `view_source_heap_sqlite` | Device source payload and lookahead are charged before projection, including shared memory row bodies. |
| Existing `p2_p5_p7_p8_the_validator_refuses_unsound_audiences` | The restored assertion specifically tests audience uniqueness, with a positive control and no positional probes. |

Migration audit:

Reviewed the diff of all 70 pre-existing Rust/JavaScript test and fixture files changed between `6d9f3e001` and `7dc85b6b7`, focusing on refusal expectations and fixture changes that could mask the original failure. The audience test was the changed authorization assertion accepting the unrelated positional refusal. No other such masked authorization assertion was found.

- `lookup_selection`, `spelling`, CLI `fix` and client `periphery` deliberately replace guessed positional index selection with `E_QUARRY_POSITIONAL_SCAN`; their named/explicit-index positive controls still compile. The explicit cursor-index repair remains exercised in `periphery`.
- `frontend_regressions` deliberately changes uncovered named point reads into scans: without a page/cap the expected refusal is now `E_QUARRY_BOUND`. Invalid extra-column type/name checks remain.
- `prefix_reads` keeps cap, caller-position, mutation visibility and expiry checks. Explicit named keys avoid the positional refusal. Program `exists` modifiers now compile by design; modifier-scope and rule-probe boundaries remain tested.
- `repairs`, CLI `check`/`fix`, and timeline admission removed obsolete missing-index refusals because planning now supplies those indexes. Structural cap/shape/authority assertions remain. The missing audience enumeration index is still tested by removing it from an otherwise valid bound core schema in `reviews.rs`.
- Other changed assertions concern selection/site text, guide block counts, sparse-filter rewrites and the deliberate declared-unique-only positional semantics. Runtime authorization assertions were retained.

Measurements:

| Read/store | Heap bytes | Outcome |
| --- | ---: | --- |
| Direct server read, 20 MB payload | 20,004,180 | incomplete, no cursor, null result |
| Projected server read, 20 MB source | 18,010,681 | incomplete, no cursor, null result |
| Projected memory device, 20 MB source | 20,009,121 | incomplete, no cursor |
| Projected SQLite device, 20 MB source | 18,010,683 | incomplete, no cursor |
| Memory device, one projected row plus source lookahead | 3,004,795 | fetched payload is charged |
| SQLite device, one projected row plus source lookahead | 18,012,639 | allocation ledger reaches heap ceiling |

WASM: 1,736,220 B raw / 480,743 B gzip, versus the reviewed artifact's 1,735,736 / 480,624: +484 raw / +119 gzip. Whole-artifact measurement, not per-change attribution. The 481,000 B budget is unchanged, with 257 B headroom.

Engineering choices and integration:

- Nullable ordered equalities use a residual filter, retaining correctness without manufacturing a nullable seek. This may examine more rows under the existing meter.
- One-source lowering is used for non-query callers. Query views retain a view-scoped cursor so wrappers, branch identity and cursor validation continue to share the view position contract.
- Projected scans conservatively accumulate the existing allocation ledger plus source retention charges. This is not a streaming/releasing optimization; no meter ceiling is raised. In particular, SQLite payload decode/scratch can cut a large-row page earlier than the memory store.
- Lane D's integration branch has additional `metered_payload` conditions in the scan implementation. When merging this fix, preserve those conditions **and** `view_scan_active`, and retain the fetched-buffer charge. No integration branch changes were imported here.
- No new syntax, diagnostic codes, authorization relaxation or serialized IR fields. Grok findings have not been supplied in this turn. Original planner-coverage limitations outside these six findings remain as recorded in the initial lane report.

Verification:

- `scripts/test.sh`: **`== 1 failure(s) in 198 s`**, exit 1. Log: `/tmp/lane-a-review-full-suite.log`.
- Its sole failing test is **baseline**: `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. Reproduce with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. It is also present in `~/sb4-intent/baseline-test.log`; no changes were made to that test or its implementation here. **Introduced failures: none. Environmental failures in this run: none.**
- Baseline reporting correction: `== 1 failure(s) in 276 s` counts one failing script step (`cargo test`), not one failing Rust target. The baseline log also contains `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots`, `census::authoring_census`, and `w9b_why_operation_keeps_residency_and_cost_output`. Those three pass in this run. The earlier lane report's statement that the baseline contained only the legacy assertion was inaccurate.
- Focused runs: all 7 new language regressions, all 8 device view tests, all 25 simulator review tests, plus 94 language tests across `intent_target`, `frontend_regressions`, `lookup_selection`, `prefix_reads` and `spelling` passed. Logs: `/tmp/lane-a-review-fixes.log`, `/tmp/lane-a-review-device.log`, `/tmp/lane-a-review-sim.log`, `/tmp/lane-a-review-lang.log`.
- Full run: all 995 client tests passed, 10 skipped; fixture tests, guide/lowering tests, builds, typechecks and WASM budget passed. No changed source file exceeds 1,500 lines. `git diff --check` is clean; `ref-check --verbose` reports zero errors.

All six supplied findings are addressed. The baseline legacy failure above remains open; the original report records planner scope limits outside this review. No further review findings have arrived during this correction turn.
