# Lane X — round 1 blind-review repairs

Date: 2026-09-25. Branch: `sb4-intent/x-familiar`.
Reviews: `~/sb4-intent/reviews/x-r0.astra.md` and
`~/sb4-intent/reviews/x-r0.grok.md`. Round-zero measurements and the 133-fact
mapping remain in [the original report](lane-x-report.md).

## Findings and resulting behavior

| Finding | Repair and evidence |
|---|---|
| Grok/Astra: incomplete self-comparison rule | One scoped validator refuses `=`, `!=`, `<`, `<=`, `>`, `>=`, and `in` with any list item equal to the same focal column. It covers read/merge filters, planned/feed-view filters, aggregate views, column aggregates, and timeline events. |
| Astra: nested read keys skipped | Keys, seek values, matching arguments and cursors retain the enclosing predicate scope. Inner filters are checked in their own scope; shape fields introduce their own focal scope. Both exact Astra examples now receive `E_QUARRY_SELF_EQUALITY`. |
| Grok: non-program rewrites | Scoped `count(*)` names the real table. Top-level comparisons use an existing compatible argument, or a whole declaration repair adds a typed argument while preserving the body. Nested comparisons use the named read key. Tests paste the diagnostic's actual rewrite through compilation and CLI `check --json`. |
| Astra: no offline mutation witness | A `predicts` mutation calls `m.twice(x)`. Both wasm/memory and native/SQLite admit a real predicted row offline. The owner reads `{value: 14, pending: true}`; a foreign-owned predicted row in the same overlay reads as null. The server still has neither row. |

## File-by-file changes

All paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/parser/predicates.rs` | Shared comparison validator, focal-scope traversal, table/argument-aware repairs and source-preserving declaration repairs. |
| `crates/snapback4-lang/src/parser/expr.rs` | Routes read/merge filters and `count(*)` through the new helpers; tracks a shape's focal scope. |
| `crates/snapback4-lang/src/parser.rs` | Parser repair context, aggregate and column-aggregate checks, helper argument context. |
| `crates/snapback4-lang/src/parser/programs.rs` | Operation argument context for repairs. |
| `crates/snapback4-lang/src/parser/views.rs` | Planned/feed predicate checks and branch shape scope. |
| `crates/snapback4-lang/src/parser/timeline.rs` | Timeline event predicate check. |
| `crates/snapback4-lang/src/lib.rs` | Only malformed self-comparison/count-star sources are reparsed with project table declarations, so later declarations and other modules supply accurate argument types/table names. Diagnostics still block binding. |
| `crates/snapback4-lang/src/guide/codes.rs` | Broadened the existing code's definition; no new refusal code. |
| `crates/snapback4-lang/src/guide/shapes.rs` | Closing limit covers all self-comparisons. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md` | Full operator/scope rule, contextual repairs and non-mechanical repair contract. |
| `crates/snapback4-lang/tests/familiar_predicates.rs` | Six round-one regression tests described below. |
| `crates/snapback4-lang/tests/familiar_guesses.rs` | Round-zero assertions now expect argument/constant/table-specific repairs. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Definition pin follows the deliberately broader refusal. |
| `crates/snapback4/tests/familiar.rs` | Pasted rewrites run through real `check --json`. |
| `crates/snapback4/tests/familiar/guesses.json` | Count-star fixture expects the actual `members` domain among the diagnostic's explicit choices. |
| `packages/snapback4/test/familiar-forms.test.mjs` | Qualified-helper offline prediction and pending-overlay read-rule witness on both stores. |
| `crates/snapback4-sim/tests/common/row_preserving_pages.rs` | Existing empty-scan fixture compares different seeded columns; all meter/cursor assertions retained. Shared by simulator and both device stores. |
| `JOURNAL.md` | One dated append-only round-one entry. |
| `reports/lane-x-round1-report.md` | This report and verification results. |

## Examples

These continue to compile and execute:

```text
members where .conversation = conversation first 20 after c
members[conversation = .conversation]   -- inside the enclosing row's shape
count(members)
view counts: count members where .active by .conversation
mutation predict(owner: principal, x: int) predicts:
  return insert predictedNotes { author: viewer, owner, value: m.twice(x) }
```

Every `.conversation OP .conversation` comparison is refused for the six scalar
operators; `.conversation in ['other', .conversation]` is also refused. Plain
boolean calculations outside filtered-row predicates retain their meaning.

## Tests and what they prove

`familiar_predicates.rs`:

1. `every_self_comparison_refuses_in_top_level_and_nested_filters_and_repairs_paste`:
   seven operators in both scopes; actual fragment/key repairs compile; includes
   Grok's singleton `in` case and a wrapped contradiction.
2. `nested_read_keys_keep_the_enclosing_predicate_scope`: Astra's exact nested-key
   example, positional/named keys, nested filters and permitted shape calculations.
3. `no_argument_repairs_add_a_typed_argument_without_losing_the_body`: absent
   id/bool arguments become valid typed parameters and other statements remain.
4. `aggregates_columns_views_and_timelines_share_the_refusal_and_repairs_compile`:
   all aggregate operators, planned views, maintained columns and timeline events;
   actual declaration repairs compile.
5. `count_star_names_the_scoped_table_and_each_concrete_repair_compiles`: unique
   table, later table, multi-table shape and multi-table predicate scopes.
6. `repairs_use_late_and_other_module_column_types_and_preserve_quoted_tails`:
   boolean column types across declaration/module order, quoted predicate tails,
   and count-star table inference across files.

`round_one_diagnostic_rewrites_paste_through_check`: real CLI refusal plus pasted
repair for all operators, count-star, missing argument, aggregate, and Astra's
nested-key case. Existing eleven failed guesses and `len` mechanical fix pass.

The device witness inspects durable queued entries to distinguish successful
prediction from a write merely queued without a row. A pending `Write` has no
predicted result field in the existing contract: results are asserted through
local queries, including `pending: true`. Both owner-visible and foreign-hidden
rows are confirmed to exist in the predicted overlay before those reads.

## Engineering decisions and scope

- Retained `E_QUARRY_SELF_EQUALITY` for compatibility while broadening its rule.
- Argument-free aggregate/timeline declarations cannot bind an operation
  argument. Their complete repair spells the comparison's explicit constant
  (`true` or `false`) and the diagnostic says to keep it only if intended, or
  write a column-to-value predicate. This invents neither an outer row nor a
  domain-specific filter. These intent-dependent repairs are never mechanical.
- With multiple tables and no focal table, count-star offers the actual table
  reads as choices; it does not guess which population the author meant.
- The existing meter fixture deliberately used a contradiction. Comparing its
  `r...` room ids with its `m...` row ids keeps the scan empty without a forbidden
  self-comparison or a planner-extracted constant key. Assertions are unchanged.
- No authorization, disclosure, durability, meter, client-source, Following,
  version, publication or push changes. No source file exceeds 1,500 lines.

## Verification

Targeted checks passed:

- `cargo test -p snapback4-lang --test familiar_predicates --test familiar_guesses --test guide`: 6 + 6 + 83 passed.
- `cargo test -p snapback4 --test familiar --test check`: 3 + 70 passed.
- `node --test packages/snapback4/test/familiar-forms.test.mjs`: 1 passed, both stores exercised.
- Shared meter regression: simulator 1 passed; native/memory device tests 2 passed.
- `bun install --frozen-lockfile`: no dependency changes.
- External `~/sb4-intent/target-clique.q`: exit 0, zero problems, six existing notes.
- `./ref-check --verbose`: zero errors and zero unchecked references.
- Wasm: 1,775,799 B raw / 495,258 B gzip; unchanged 496,000 B budget.
- The 133 moved facts and 17 original compiled blocks remain covered by the guide tests.
- Cards now total 10,420 words, still a 43.1% reduction from 18,300; the round-one wording only changes the shapes limit.

The first full run finished with **`== 1 failure(s) in 411 s`**, exit 1.
It had three **introduced** Rust test failures, all the shared
`w13i_helpers_preserve_a_meter_cut_and_continue_its_filtered_source` fixture:

1. `snapback4-device::device::row_preserving_pages::memory::cases`.
2. `snapback4-device::device::row_preserving_pages::sqlite::cases`.
3. `snapback4-sim::clique::row_preserving_pages::cases`.

Each is caused by its old self-inequality predicate, deliberately refused by this
round. The fixture correction above preserves every assertion. No failure is
waived or attributed to the supplied older baseline. During targeted development,
stale rewrite/guide expectations, a missing newline in the test's pasted table,
and declaration-order argument-type inference also failed; all were corrected
and covered before the final run.

Final default-concurrency `scripts/test.sh`, exit 0:
**`== 0 failure(s) in 409 s`**.
All blocking phases passed. Client tests: 1,519 total, 1,509 passed, ten existing
skips, zero failures. Client models: 78 passed, zero failures; retained
5,000 online-session / 5,000 local-session / 3,000 online-client sequences.
Final failures: **ours 0, baseline 0, environmental 0**.

Raw logs are on this host; SHA-256 binds the recorded outputs:

| Log | SHA-256 |
|---|---|
| `/tmp/lane-x-r1-suite.log` | `225b3c79b720b4855bd1fd139a22fccf2d4f06f0857871ae86ffdca09187829e` |
| `/tmp/lane-x-r1-suite-final.log` | `9df2a9d754127caa95d438dd5d15ac57478afb64a1412ec8596ce9e140410e89` |
| `/tmp/lane-x-r1-lang-guide.log` | `881a8c5a20e1d48cf90490dde333022607fba1e33931431fec8d558b41ef36aa` |
| `/tmp/lane-x-r1-cli.log` | `53c029a4b22322ca9fadd700a81566b8d647f0f0efb48fef8c3eff20e4bf5c46` |
| `/tmp/lane-x-r1-devices.log` | `75e5311337e88681ce60a5f8579d5050eeed473f8323f9820cbd5b05ebf8d482` |
| `/tmp/lane-x-r1-meter-sim.log` | `d8a8f9fc1daa94a64237b4b50e096f8253d32dac0b480fdb2944249b80d21439` |
| `/tmp/lane-x-r1-meter-device.log` | `7e6d263822b68a99f151e7f6b082e9dd4a2a5077a7a7e393dee645e7b2497576` |

Reproduce from `~/sb4-intent/lane-x/snapback4` after setting the specified PATH:

```sh
cargo test -p snapback4-lang --test familiar_predicates --test familiar_guesses --test guide
cargo test -p snapback4 --test familiar --test check
node --test packages/snapback4/test/familiar-forms.test.mjs
cargo test -p snapback4-sim --test clique w13i_helpers_preserve_a_meter_cut_and_continue_its_filtered_source
cargo test -p snapback4-device --test device w13i_helpers_preserve_a_meter_cut_and_continue_its_filtered_source
scripts/test.sh
```

Implementation commits: `7e6c2b88b` (predicate scopes and repairs), `3cabf3701`
(offline prediction witness), `b98b64bf1` (meter fixture). A final documentation
commit records this report and the journal. All commits carry the required
co-author trailer; nothing was pushed or published.

## Open problems and deviations

No unresolved round-one finding or design counterexample. The unchanged full
suite still exceeds its documented 60-second budget, as it did in round zero
and the supplied baseline. Reproduce with `scripts/test.sh`; this lane does not
change suite scheduling or its model sequence counts. No other deviation.
