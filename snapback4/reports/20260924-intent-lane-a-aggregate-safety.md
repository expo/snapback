Lane A final aggregate delta — 2026-09-24

Branch `sb4-intent/a-planner`, parent `3562069d8`. Fixes both Medium findings and closes the one-sided range test gap. Nothing pushed or published.

Changes, file by file (relative to the repository root):

| File | Change |
| --- | --- |
| `snapback4/crates/snapback4-lang/src/bind/intent_aggregates.rs` | Carry required-parameter facts separately for each program and helper. Infer ordering only from endpoints proved present and non-failing; reject a candidate column if any sibling range endpoint on it lacks that proof. Skip inferred aggregate ordering when the intrinsic id is pinned. Keep deterministic finite-window preference and the one-sided fallback. |
| `snapback4/crates/snapback4-lang/tests/intent_aggregate_safety.rs` | Five runtime regressions for guarded division/overflow, nullable narrowing, named-id reads, one-sided seeks, and helper parameter proofs. |
| `snapback4/crates/snapback4-lang/tests/intent/aggregate_plans.rs` | Add a direct planner test of the one-sided fallback, asserting order and seek direction. |
| `snapback4/crates/snapback4-lang/src/guide/reads.rs` | Describe preserved guards and named-id aggregate access. |
| `llp/3000.013-quarry-states-intent.rfc.md` | Record endpoint safety, unsafe sibling bounds and intrinsic-id access under §5.1; update revision metadata. |
| `snapback4/JOURNAL.md` | Append one dated entry with scope and verification. |
| `snapback4/reports/20260924-intent-lane-a-aggregate-safety.md` | This correction and evidence record. |

Forms compiled and executed:

- `count(t where d != 0 and .at > 10 / d)` returns 0 when d is 0. Corresponding `sum((t where d != 0 and .at > 10 / d), .at)` and `exists t where d != 0 and .at > 10 / d` return 0 and false. A nonzero input selects the expected rows, proving that the predicate still executes when its guard permits it.
- With `x: time ?`, `count(t where x != null and .at > x)` compiles and returns 0 for null, preserving the narrowing inside the row predicate. Sum and exists are covered too. A safe additional `.at < 100` cannot cause extraction of the unsafe lower bound.
- `count(t[id = x] where .at > 10)`, `sum((t[id = x] where .at > 10), .at)` and `exists t[id = x] where .at > 10` keep only `byId`, with the same executable program and table/index schema as explicit `by .id`. Matching, nonmatching and absent ids yield the correct results and examine at most one row.
- `count(t where .at > start)` infers `(at, id)` and a lower seek. A 100-row seed with start=96 returns 3 while examining at most 3 rows, excluding the 97-row prefix from examined work. Sum returns 294 and exists returns true under the same examination ceiling.

Tests added:

| Test | What it proves |
| --- | --- |
| `aggregate_bounds_preserve_division_and_overflow_guards` | All three consumers preserve a false division guard and an integer-overflow guard. Safe sibling upper bounds in either conjunct order do not make the lower endpoint eager. Positive cases still evaluate the residual and return the expected result. Compiled scans have no inferred range. |
| `aggregate_bounds_preserve_nullable_parameter_narrowing` | All consumers compile optional time endpoints guarded by `!= null`, both alone and beside a safe upper bound; null and present runtime values preserve their expected meaning. |
| `aggregate_named_id_prefix_keeps_single_row_filtering` | All consumers match the explicit-id plan and schema, create no index, retain the row filter, and examine at most one row for matching, filtered and missing ids. |
| `aggregate_lone_lower_bound_seeks_without_examining_the_prefix` | A lone lower bound becomes a seek; count/sum/exists are complete and examine at most the three qualifying rows rather than the excluded 97-row prefix. |
| `aggregate_endpoint_proofs_follow_helper_parameter_types` | A required helper parameter remains seekable, an optional helper parameter cannot inherit the caller's same-name required fact, and a potentially failing helper call remains guarded. |
| `aggregate_lone_range_uses_the_one_sided_fallback` | The uncapped planner AST uses order `(at,id)` and exactly the `at > s` seek for a lone lower bound. |

Before the fixes, the new runtime target had three failures: an unsafe inferred range, the nullable seek type error, and the duplicate id schema error. The one-sided positive case already passed, establishing its baseline. Log: `/tmp/lane-a-aggregate-safety-before.log`.

Temporarily deleting `.or_else(|| ranges.first_key_value())` now fails the new one-sided runtime test at its seek assertion. Restored the planner before final verification. Log: `/tmp/lane-a-aggregate-one-sided-mutant.log`. The negative control is intentional and is not a final-suite failure.

Engineering choices and scope:

- The proof is deliberately conservative: non-null literals, required declared program/helper parameters, `now` and `viewer` are eligible. Arithmetic, calls, nullable values, member access and unknown locals remain residual unless a later compiler pass owns a suitable proof. Required parameters cannot be reassigned or shadowed. No new data-flow analysis or endpoint evaluation is introduced here.
- Reject a whole candidate column if a range endpoint is unsafe, because choosing that order would make existing planning extract its sibling endpoints too. This preserves the whole predicate's short-circuit behavior without changing AST/IR representations.
- A pinned id already selects at most one row. Remaining comparisons filter that row; no `(id, at, id)` index is synthesized.
- Lane A's runtime fixtures retain their existing caps. In the isolated integration checkout at `cf803ffcafcb4ce8e1e585fffe70be444679940f`, the same new planner and runtime target passed **5/5**, with the named-id fixture's cap removed, using Lane D's streaming binder. The live integration checkout was not modified. Log: `/tmp/lane-a-aggregate-safety-integration.log`.
- No deviation from the requested correction, new diagnostic, syntax change, engine/IR change, scan-admission relaxation, authorization/disclosure change or meter increase. No new open problem in this review's scope. Earlier program-wide scope limits remain recorded in `reports/20260924-intent-lane-a.md`.

Verification:

- **123 affected tests passed:** 105 language integration tests (`guide` 55, `intent_aggregate_safety` 5, `intent_followup` 4, `intent_nulls` 7, `intent_order` 3, `intent_review` 7, `intent_target` 21, `lane_domains` 3), 4 aggregate planner unit tests, and 14 device view tests. Logs: `/tmp/lane-a-aggregate-safety-affected.log`, `/tmp/lane-a-aggregate-safety-unit.log`, `/tmp/lane-a-aggregate-safety-device.log`.
- `scripts/test.sh`: **`== 1 failure(s) in 144 s`**, exit 1. Log: `/tmp/lane-a-aggregate-safety-full-suite.log`. The only failed step is `cargo test`, containing exactly one failed test: **baseline** `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. This also fails in `~/sb4-intent/baseline-test.log` and remains unchanged. Reproduce from `snapback4/` with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. **Introduced failures: none. Environmental failures: none.**
- All **995 client tests passed**, 10 skipped. Builds, fixtures, guide tests and typechecks passed. WASM remains **1,736,564 B raw / 480,855 B gzip**, within the unchanged 481,000 B budget.
- Reference and whitespace checks pass; all changed source files remain below 1,500 lines.
