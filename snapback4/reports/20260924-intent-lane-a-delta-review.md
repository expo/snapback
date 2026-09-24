Lane A delta review corrections — 2026-09-24

Branch `sb4-intent/a-planner`, parent `dd0552d79`. This fixes the High and Medium introduced by the previous nullable-membership correction, and strengthens the fixtures as requested. The supervisor reports that all earlier findings were verified fixed. Nothing pushed or published.

Changes, file by file (relative to `snapback4/`):

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/bind/program/views.rs` | Detect residual predicates referencing a planned lane's selector with the existing authored-merge dependency check. Preserve a separate selector in each lane's setup and bind the filter to it. The nonempty setup selects existing eager execution; deduplication continues to read the original source binding. Also exclude bound range sources from null fallback handling. |
| `crates/snapback4-lang/src/bind/intent_lanes.rs` | Recognize `range` as a non-null source before planning a fallback, avoiding an unnecessary fallback read and index. |
| `crates/snapback4-lang/tests/intent_nulls.rs` | Add three regressions for ordered nullable values, range compatibility and multi-owner mutation results. Expand the shared fixture to two distinct authorized owners, hidden rows for each owner and null, and an authorized nonmatching owner. Test one-row paging by both timestamp and nullable owner in both directions. |
| `crates/snapback4-device/tests/intent_views.rs` | Strengthen both Memory and SQLite nullable-membership tests: two authorized owners, nullable owner ordering, ascending/descending one-row pages, plain/projected reads, reopen, hidden rows and absent device coverage. |
| `JOURNAL.md` | Append one dated entry with scope, measurements and validation. |
| `reports/20260924-intent-lane-a-delta-review.md` | This correction and evidence record. |

Corrected forms, compiled and executed:

- `t where .at in [null, 1, 2] first 10 by .at after c`, for `at: int ?`, returns null, 1 and 2. `first 1` visits all three across pages; `last 1` visits 2, 1, null. `[1, 2]` returns both values. Reordered duplicate values preserve the same result.
- `t where .at in range(1, 3) first 10 by .id after c` compiles for both `int` and `int ?` and returns 1 and 2, without a null fallback. Dynamic `range(lo, lo + 2)`, empty ranges, nullable-column ordering and descending pages are covered too.
- `posts where .reader = viewer and .owner in [null, first(owners), last(owners)] first 10 by .owner` preserves both authorized owners in a mutation. Plain, word-search and projected query variants page by that optional field one row at a time in both directions.

Regression proofs:

| Test | What it proves |
| --- | --- |
| New `ordered_nullable_membership_preserves_every_distinct_value` | The review's scalar reproducer retains every distinct non-null value, with/without null, with duplicates, for full pages and one-row continuations in both directions. Before the fix it returned ids `0, 2` instead of `0, 1, 2`. |
| New `nullable_membership_accepts_nonnull_range_sources_without_a_fallback` | Literal, dynamic and empty range sources work against required and optional columns, ordered by id or the membership column, in both directions and page sizes. Compiled plans contain exactly one scan. Before the fix the optional form refused with `E_QUARRY_TYPE: nullable in needs a bounded list`. |
| New `nullable_membership_mutations_preserve_both_authorized_owners` | Mutations retain all six matching rows from null, Alice and Bob, in nullable-column order in both directions, excluding hidden and nonmatching rows. |
| Strengthened `nullable_value_lanes_page_in_both_directions_with_words_and_projection` | Two distinct non-null owners survive all three query paths and both order choices; equal-key ties and terminal cursors remain correct. Before the fix, nullable-owner ordering silently omitted Alice's rows. |
| Strengthened `nullable_membership_memory` / `nullable_membership_sqlite` | The corrected ordered membership survives sync and reopen in the shared device interpreter, in both directions, with complete pages. Hidden rows remain absent; absent coverage remains incomplete without a cursor. |
| Existing null-prefix, duplicate/meter and discovery-cut tests | Evaluated prefixes still contain no null; duplicate values do not add examined rows; authorization and cut behavior remain checked against the expanded fixture. |

Engineering choices and scope:

- Reuse the existing eager-setup contract for a lane-dependent filter. Do not broaden lazy preparation to capture arbitrary environments. Each lane's selector is set immediately before its scan, while its distinct key is evaluated from the original discovery binding.
- Range sources contain integers only. Exclude them during planning and retain a defensive range check in binding; neither path requires a filtered null scan.
- No design deviation, new syntax, diagnostic code, serialized IR field, engine change, authorization relaxation, scan-admission relaxation or meter/budget increase. Existing guide text remains accurate.
- No new open problem within these findings. Earlier planner scope limits remain documented with reproductions in `reports/20260924-intent-lane-a.md`.

Verification:

- Before implementation, the expanded tests reproduced both reported product failures, including the omitted authorized owner. Log: `/tmp/lane-a-delta-repro.log`.
- Focused language tests: **93 passed** — `guide` 55, `intent_nulls` 7, `intent_review` 7, `intent_target` 21, `lane_domains` 3. Device `intent_views`: **10 passed**. Logs: `/tmp/lane-a-delta-affected.log`, `/tmp/lane-a-delta-device.log`.
- `scripts/test.sh`: **`== 1 failure(s) in 141 s`**, exit 1. Log: `/tmp/lane-a-delta-full-suite.log`. The only failed step is `cargo test`, with exactly one failed test: **baseline** `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. It also fails in `~/sb4-intent/baseline-test.log`. Reproduce from `snapback4/` with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. This baseline problem remains open and unchanged. **Introduced failures: none. Environmental failures: none.**
- All **995 client tests passed**, 10 skipped. Builds, typechecks, fixtures and guide tests passed. WASM is unchanged at **1,736,564 B raw / 480,855 B gzip**, within the unchanged 481,000 B budget.
- `ref-check --verbose` reports zero errors and zero unchecked references. `git diff --check` is clean. All changed source files remain below 1,500 lines.

Both delta findings are addressed; no additional open problem was found within this review's scope.
