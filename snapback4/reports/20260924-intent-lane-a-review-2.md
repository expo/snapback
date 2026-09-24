Lane A review round 2 corrections — 2026-09-24

Branch `sb4-intent/a-planner`, on top of `260c809d2`. This report covers the three Grok findings supplied by the supervisor. The first review's six fixes remain in that parent commit. Nothing pushed or published.

Changes, file by file (relative to `snapback4/`):

| File | Correction |
| --- | --- |
| `crates/snapback4-lang/src/ast.rs` | Compiler-only metadata carries an optional nullable-membership fallback read. No serialized IR field is added. |
| `crates/snapback4-lang/src/bind/intent_lanes.rs` | Nullable `in` plans one additional ordinary read, retaining other predicates and removing the value-dependent pin. Non-null values retain their deduplicated lanes. |
| `crates/snapback4-lang/src/bind/intent.rs` | Choose the fallback's index before adding its residual null equality. Delete the incorrect `!= null` wrapper from residual membership, including mutations. |
| `crates/snapback4-lang/src/bind/intent_walk.rs` | Traverse the fallback read during synthesized-index name resolution. |
| `crates/snapback4-lang/src/bind/program/views.rs` | Evaluate each value-list source once, cache its values and record at most one null sentinel. Bind the fallback through ordinary scan admission and copy projection/branch identity where applicable. All work uses existing metered IR statements and lane discovery. |
| `crates/snapback4-lang/src/bind/intent_views.rs` | Initialize the optional fallback metadata for view branches. |
| `crates/snapback4-lang/src/bind/intent_windows.rs` | Initialize the optional fallback metadata for bucket lanes. |
| `crates/snapback4-lang/src/parser/expr.rs` | Initialize the optional fallback metadata for authored merges. |
| `crates/snapback4-core/src/engine/read.rs` | Translate the validated shared cursor to another index as well as another table, checking that its ordered suffix is identical. This lets the ordinary filtered null lane resume alongside value-pinned lanes. Null values still never open pinned lanes. |
| `crates/snapback4-lang/src/guide/reads.rs` | Document the null filtered lane and ordinary source authorization; replace the obsolete claim that null membership is skipped. |
| `crates/snapback4-lang/tests/intent_target.rs` | Correct the null-membership expectation for queries and mutations, inspect both scan plans, and strengthen the finite-window upper-bound oracle. |
| `crates/snapback4-lang/tests/intent_nulls.rs` | Four additional runtime regression tests described below. |
| `crates/snapback4-device/tests/intent_views.rs` | Two additional regressions cover Memory and SQLite device paging, reopen and absent coverage. |
| `JOURNAL.md` | Append one dated entry with verification, measurements and scope. |
| `reports/20260924-intent-lane-a-review-2.md` | This correction and integration record. |

Corrected forms, exercised in compiled runtime tests:

- `posts where .owner in [null, viewer, viewer] first 10 after c` returns both authorized null-owner and viewer-owned rows, once each. Null never becomes a scan prefix.
- A mutation's `return posts where .owner in [null, viewer, viewer] first 10` keeps scalar membership semantics and returns the same rows. Existing mutation admission remains in force.
- `posts where .reader = viewer and .owner in values matching 'hello' first 1 by .at after c` preserves the null match through word search and pagination. Plain reads and projected `events` reads have the same membership behavior; `last` is covered too.
- `posts where .at > now - 24h and .at <= now + 3h last 20 by .likeCount, .at after c` excludes a row one millisecond past the upper endpoint within its last bucket, and a row in the next bucket. Its oracle is an explicit ordinary scan with both predicates retained.

Regression proofs:

| Test | What it proves |
| --- | --- |
| `value_lanes_filter_null_without_pinning_and_deduplicate` (renamed) | Both seeded rows return in the query and mutation; the compiled query contains value lanes and a filtered ordinary null scan, with no literal null prefix. Replaces the old test that incorrectly asserted omission. |
| `nullable_value_lanes_page_in_both_directions_with_words_and_projection` | Equal timestamps, null-only and non-null lanes, word search and projected rows paginate without gaps or duplicates in both directions. The test asserts two compiled scans so a residual-only plan cannot accidentally satisfy it. |
| `nullable_lists_preserve_membership_deduplication_authorization_and_cuts` | Empty, null-only, non-null-only and duplicate lists produce exact results; duplicates do not increase examined rows. Hidden null rows remain hidden. Non-uniform merges remain incomplete without a cursor, and an examined-meter opening cut has no continuation. |
| `nullable_value_discovery_cuts_never_publish_a_prefix_cursor` | A sweep of 159 step ceilings across three read forms either produces the ordinary `E_BOUND` refusal or an outcome obeying the incomplete/no-cursor contract. Interrupted cached-list setup cannot become an unrelated runtime error. |
| `nullable_membership_never_sends_a_null_prefix_to_the_store` | A store wrapper inspects evaluated scan prefixes, including dynamic values, and rejects any null prefix for plain, word and projected reads. |
| `nullable_membership_memory`, `nullable_membership_sqlite` | After sync and device reopen, each store returns both authorized rows across one-row pages through both plain and projected reads. Hidden rows stay absent. A source without device coverage remains incomplete with no cursor. |
| `finite_windows_match_manual_trending_and_include_future_buckets` (strengthened) | The bounded bucket plan equals an independent scan retaining both endpoints (7 rows); an unbounded control sees the two excluded rows too (9). The existing handwritten Trending comparison remains. |

Engineering choices and deviations:

- The latest review correction supersedes addendum 2's instruction to skip null values: null still opens no **pinned** lane, but nullable membership now opens one ordinary filtered lane when needed. No null-index-pin rule is relaxed.
- The compiler lowers the fallback using existing `Block`, list, loop and merge IR. The list is evaluated once during discovery; its cached null sentinel is reused, preserving cap/cut tracking rather than independently rereading the producer. Serialized IR definitions are unchanged.
- The fallback may scan more source rows than a non-null pin; the existing meter bounds that work. Where indexes differ, the existing eager merge handles the ordered union. No lazy-merge admission or drain policy is widened.
- Mutations retain ordinary admitted residual scans. No streaming aggregate admission, source rule, sync coverage check, meter ceiling or capability budget is relaxed.
- The reviewer probe `crates/snapback4-lang/tests/probe_review_tmp.rs` was absent on inspection; there was nothing to delete.
- No other design deviation. Earlier scope limitations outside these review findings remain recorded in `reports/20260924-intent-lane-a.md`.

Measurements and verification:

- Focused tests: all 87 language tests passed (`guide`: 55, `intent_nulls`: 4, `intent_review`: 7, `intent_target`: 21). All 10 device `intent_views` tests passed. Logs: `/tmp/lane-a-r2-lang.log`, `/tmp/lane-a-r2-device.log`.
- WASM: **1,736,564 B raw / 480,855 B gzip**, versus parent measurement 1,736,220 / 480,743: **+344 raw / +112 gzip**. This is a whole-artifact measurement, not independent component attribution. The 481,000 B budget is unchanged, leaving 145 B headroom. Log: `/tmp/lane-a-r2-wasm.log`.
- `scripts/test.sh`: **`== 1 failure(s) in 165 s`**, exit 1. Log: `/tmp/lane-a-r2-full-suite.log`. The only failed step is `cargo test`, with exactly one failed test: **baseline** `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. It also fails in `~/sb4-intent/baseline-test.log`. Reproduce from `snapback4/` with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. This baseline problem remains open and was not modified. **Introduced failures: none. Environmental failures: none.**
- Full run: all 995 client tests passed, 10 skipped. Builds, typechecks, fixtures, guide tests and WASM budget passed. The other three failures recorded in the original baseline (`uniform_word_expansion`, `authoring_census`, and the CLI operation-cost assertion) pass here.
- `ref-check --verbose`: zero errors and zero unchecked references. `git diff --check` is clean. Every changed source file stays below 1,500 lines.

All three supplied round 2 findings are addressed. No new open problem was found within their scope; the baseline assertion and previously reported planner limitations remain open with their reproductions recorded above and in the original lane report.
