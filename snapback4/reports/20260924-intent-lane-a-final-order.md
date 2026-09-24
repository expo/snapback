Lane A final table-order ruling — 2026-09-24

Branch `sb4-intent/a-planner`, parent `86b88f4ae`. Implements the supervisor's final ruling and resolves the table-cursor design stop recorded in `reports/20260924-intent-lane-a-followup-review.md`. No push or publication.

Changes, file by file (relative to the repository root):

| File | Change |
| --- | --- |
| `snapback4/crates/snapback4-lang/src/bind/intent.rs` | Normalize authored table orders at their first `id`, before equality-pin selection, value/window lane expansion, and view expansion. Traverse programs, helpers, named shapes and reads inside view branch predicates/projections. Preserve the authored read spelling for provenance. |
| `snapback4/crates/snapback4-lang/src/bind/mod.rs` | Invoke normalization immediately after catalog construction and before planned views expand into source lanes. This keeps a view's source ordering intact. |
| `snapback4/crates/snapback4-lang/src/guide/reads.rs` | Explain table truncation and the different identity/order contract for view branches. |
| `snapback4/crates/snapback4-lang/src/guide/language.rs` | Add a compiled `intentIds` query using `by .id, .at after c`. |
| `snapback4/crates/snapback4-lang/tests/intent_order.rs` | Three new regressions covering plan/page equality, nested reads and retained cross-branch ordering. |
| `llp/3000.013-quarry-states-intent.rfc.md` | Record the supervisor's ruling in §2.1, align §3.1 with existing branch-aware cursor identity, and update the revision date. |
| `snapback4/JOURNAL.md` | Append one dated entry with results and scope. |
| `snapback4/reports/20260924-intent-lane-a-final-order.md` | This final correction report. |

Forms compiled and executed:

```quarry
table t:
  at: time
  public 't'
query page(c: cursor ?):
  return t first 1 by .id, .at after c
```

This compiles to the identical executable program and table/index schema as `return t first 1 by .id after c`. The only index is the intrinsic `byId`. Seed `(id, at) = (a,3), (b,2), (c,1)`: ascending pages visit a, b, c; replacing `first` with `last` visits c, b, a. All pages are complete, both spellings return identical opaque cursor tokens, and the final page has no next cursor.

Truncation applies wherever id occurs: `t first 1 by .rank, .id, .at, .rank after c` matches `t first 1 by .rank, .id after c`. Predicates, word search, inferred value lanes, nested aggregate arguments and shaped reads use the same normalization. For example, `t where .at = 2 first 1 by .id, .at after c` matches its `by .id` plan, including the equality pin on the discarded order field. View reads retain `v first 1 by .id, .at after c` unchanged, including at for ties between different branches carrying the same id.

Tests added:

| Test | Proof |
| --- | --- |
| `table_order_after_id_has_identical_plans_and_cursor_pages` | In both directions, compare complete executable IR and table/index schemas for both spellings, then compare every returned row, completeness bit and opaque cursor token. Cases: bare id order, id in the middle, equality on a discarded order column, `in` lanes and word search. Assert the bare form has only `byId`; no synthesized index. |
| `nested_table_orders_normalize_before_planning` | Compare identical IR/index schemas for table reads inside count arguments, returned object shapes and a view projection's count expression. All use only `byId`. |
| `union_order_after_literal_id_keeps_cross_branch_ties` | Two source tables have colliding ids x and y with different timestamps. One-row ascending pages return timestamps 1,3,2,4; descending pages return 4,2,3,1. Complete pages and cursors preserve every event and the later at key. |

Decisions and deviations:

- Normalize the authored AST before view expansion, so generated source-table lanes retain the view's shared order without adding a flag or changing IR. Keys after id are discarded before predicate extraction; equality predicates on those columns can still become pins.
- Executable plans and table schemas are equal; source provenance intentionally retains each authored spelling for diagnostics and cost explanations.
- No deviation from the ruling. No duplicate index components, uniqueness changes, cursor-admission changes, engine changes, authorization/disclosure relaxation, or meter increase. The formerly stopped table read now compiles and runs. No new open problem in this round; earlier program-wide limitations remain recorded in `reports/20260924-intent-lane-a.md`.

Verification:

- **117 affected tests passed:** 100 language integration tests (`intent_order` 3, `intent_followup` 4, `intent_nulls` 7, `intent_review` 7, `intent_target` 21, `lane_domains` 3, `guide` 55), 3 aggregate planner unit tests, and 14 Memory/SQLite device view tests. Logs: `/tmp/lane-a-final-order-affected.log`, `/tmp/lane-a-final-order-unit.log`, `/tmp/lane-a-final-order-device.log`.
- `scripts/test.sh`: **`== 1 failure(s) in 142 s`**, exit 1. Log: `/tmp/lane-a-final-order-full-suite.log`. The only failed step is `cargo test`, containing exactly one failed test: **baseline** `snapback4-core::schema_capabilities_legacy::genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`, the schema equality assertion at `crates/snapback4-core/tests/schema_capabilities_legacy.rs:20`. This is present in `~/sb4-intent/baseline-test.log` and remains unchanged. Reproduce from `snapback4/` with `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier`. **Introduced failures: none. Environmental failures: none.**
- All **995 client tests passed**, 10 skipped. Builds, guide tests, fixtures and typechecks passed. WASM is unchanged at **1,736,564 B raw / 480,855 B gzip**, within the unchanged 481,000 B budget.
- `ref-check --verbose`: zero errors and zero unchecked references. Whitespace checks pass. Changed source files remain below 1,500 lines.
