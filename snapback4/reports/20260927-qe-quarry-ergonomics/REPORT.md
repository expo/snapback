# Lane QE — Quarry ergonomics for 0.4.5

2026-09-27. Branch `sb4-intent/qe-quarry-ergonomics`, base `9473e0a34`.
Implementation commit: `3f15449c4`; fixture-location correction: `5b81caff1`.
No push or publication.

Both requested compiler fixes are built. No runtime, authorization, disclosure,
durability, IR format or meter ceiling changed. No diagnostic code was added.

## Changes, file by file

Paths below are relative to `snapback4/` except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/bind/program.rs` | Track enclosing caller loops separately from lexical helper loops. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Preserve caller loop placement through nested helper expansion for automatic-sweep and argument-presence checks; keep lexical jumps. Give nonconverging list item types a self-append rewrite. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Lower list `+` expressions to existing metered `Concat`, join item types, add bounds, and explain mixed list/scalar operands. |
| `crates/snapback4-lang/src/guide/language.rs` | Teach list concatenation expressions before local self-append. Preserve the pinned self-append fact. |
| `crates/snapback4-lang/src/guide/jobs.rs` | Express the digest's totals with a record-returning helper and explain caller placement and lexical jumps. |
| `crates/snapback4-lang/src/guide/programs.rs` | Point helper callers to the loop-placement contract. |
| `crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q` | Share the brief's exact helper digest between compiler and engine tests. |
| `crates/snapback4-lang/tests/helper_placement.rs` | Seven placement, lowering and comparative reproductions, described below. |
| `crates/snapback4-lang/tests/list_expressions.rs` | Nine expression, type, evaluation-order and meter regressions, described below. |
| `crates/snapback4-sim/tests/helper_sweep.rs` | Run helper and inline jobs through multiple committed chunks and compare every emitted payload. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Record list-expression semantics in §5.1 and inherited loop placement with lexical jumps in §5.2. |
| `JOURNAL.md` | One dated append recording implementation and qualification. |
| `reports/20260927-qe-quarry-ergonomics/REPORT.md` | This review report and reproducible remaining limitation. |

Every changed source file remains below 1,500 lines. Guide lead paragraphs
remain within 45 words. The complete guide test preserves existing compiled
blocks, fact homes, and the unchanged aggregate word limit.

## Forms that compile and run

The shared fixture is a complete runnable example of a helper containing a loop
inside a job's recipient sweep:

```quarry
fn unreadFor(p: profiles):
  total = 0
  for m in members where .principal = p.principal:
    total = total + m.unread
  return total
job digest():
  for p in profiles:
    n = unreadFor(p)
    if n > 0:
      emit notify { target: p.principal, unread: n }
```

The engine regression seeds 130 recipients, including 26 quiet recipients,
and three membership rows each. It checks a committed first chunk with a
proper subset of the effects, completes the job, and verifies all 104 expected
effects, their exact totals, and identical payloads from helper and inline jobs.

List concatenation uses the same expression in all tested positions:

| Position | Example |
| --- | --- |
| Return | `return xs + [x]` |
| Another local | `ys = xs + [x]` |
| Literals | `[a] + [b]` |
| Helper argument | `identity([1] + [2])` |
| Record field | `{ xs: [1] + [2] }` |
| Conditional arm | `xs + [2] if ready else []` |
| Loop domain | `for x in [1] + [2]:` |
| Existing self-append | `xs = xs + [x]` continues to emit `Push`. |
| Other finite-item loop growth | `xs = [x] + xs`, `xs = xs + [x, x]`, or `ys = xs + [x]` followed by `xs = ys`. |

Concatenating `[text <=5] <=2` and `[text <=10] <=3` produces
`[text <=10] <=5`. Empty lists, nullable items, record-field joins and nested
lists follow literal joins. Incompatible row kinds retain `E_QUARRY_SHAPE_JOIN`.
`[1] + 2` reports `E_QUARRY_TYPE`, its source site, both operand types, and
the rewrite `xs + [x]`.

## Tests and what they establish

`helper_placement.rs`:

| Test | Proof |
| --- | --- |
| `helper_accumulation_inherits_the_recipient_loop` | Direct and nested helpers inherit the caller's sweep placement. |
| `helper_break_and_continue_cannot_target_the_callers_loop` | Both jumps refuse without a helper-local loop and compile with one. |
| `top_level_helper_still_refuses_a_cross_chunk_accumulator` | Top-level helper loops retain the existing automatic-sweep diagnostic. |
| `optional_filter_helper_uses_the_callers_sweep_placement` | Bounded optional-filter alternatives compile inside a recipient helper and refuse as a top-level sweep. |
| `unbounded_optional_domains_still_need_a_page_bound_in_both_forms` | The separate page-bound limitation remains identical for helper and inline forms. |
| `comparative_three_accumulations_return_a_record_from_a_helper` | Reconstruct the builder's three totals from its final schema, with its actual windows and schedule modules; the full program compiles. |
| `helper_and_inline_have_the_same_ir_apart_from_helper_temporaries` | Complete IR equality after removing pure argument/result copies and the unused final-return flag, then alpha-renaming variables. Scans, accumulation, conditions and emission remain in the comparison. |

`list_expressions.rs`:

| Test | Proof |
| --- | --- |
| `lists_concatenate_in_returns_bindings_arguments_records_and_loops` | All seven expression positions execute to `[1, 2]`. |
| `item_joins_match_literals_and_bounds_add` | Empty, optional, object and nested-list item joins agree with literals; operand bounds add. |
| `a_list_and_a_scalar_get_a_list_rewrite` | Both operand orders and nonnumeric scalars receive a located list diagnostic. |
| `self_append_keeps_its_in_place_lowering_and_loop_growth` | Existing self-append retains `Push`, and its result can be concatenated in a return. |
| `other_loop_concatenations_keep_fixed_item_types_under_the_heap_meter` | Prepend, bulk append and an intermediate alias preserve ordered results across iterations. |
| `recursive_loop_concatenation_names_the_self_append_rewrite` | Mutually nested accumulators refuse with the concrete fixed-item self-append rewrite; that rewrite executes. |
| `concatenation_respects_operand_evaluation_order` | Left-side division-by-zero occurs before a right helper's failure. |
| `list_concatenation_remains_heap_metered` | At a 1,024-byte test heap ceiling, a query becomes incomplete and a mutation refuses `E_BOUND` naming heap. |
| `conflicting_row_kinds_keep_the_literal_join_refusal` | Row versus spread-object concatenation retains the existing shape-join refusal at `[]`. |

`helper_sweep.rs` contains
`helper_and_inline_digest_emit_the_same_effects_across_chunks`, the actual engine
execution described above.

The positive regressions were also run with the two fixes temporarily disabled,
then the original working source was restored byte-for-byte. The compiler run
failed (exit 101: helper tests 1 passed / 6 failed; list tests 0 passed / 9 failed),
and the engine regression failed (exit 101). The top-level refusal is the
intentional control that already passed. Logs are under `target/lane-qe/`.

Affected qualification: whole guide 86/86, helper placement 7/7, list expressions
9/9, joined shapes 17/17, optional-variant review 9/9, and engine helper sweep 1/1.
Reference audit: 515 LLP documents, 9,579 refs, zero errors or unchecked refs.

The full suite exposed that its frozen compatibility inventory includes every
top-level `tests/fixtures/*.q`. Moving the new fixture under `fixtures/qe/`
preserves the original inventory and bytes without changing the test or its
baseline. The follow-up passes `ephemeral_compat` 1/1, helper placement 7/7,
and engine helper sweep 1/1. No product code changed after the suite started.

## Comparative first pass and remaining limitation

The record-returning helper reconstructed from the final builder source
accumulates `unreadMessages`, `unreadChats`, and `newPostsInFollowing` over
`members` and `follows`. Before the placement fix it reports automatic-sweep
`E_QUARRY_PLACEMENT` for `unreadChats` and `newPostsInFollowing`, followed by a
schedule cascade because the job did not bind. After the fix there are no
diagnostics, including no `E_QUARRY_BOUND`.

The original failed first-pass source and its cited `evidence/m8-check.txt` are
not in this checkout; the run log records both codes but cannot establish what
expression caused the original bound diagnostic. This reconstruction therefore
does not claim to identify that historical expression.

A concrete remaining `E_QUARRY_BOUND` reproduction uses the shared fixture's
tables and changes the helper/call to:

```quarry
fn unreadFor(p: profiles, amount: int ?):
  total = 0
  for m in members where .principal = p.principal and (amount = null or .unread = amount):
    total = total + m.unread
  return total
job digest(amount: int ?):
  for p in profiles:
    n = unreadFor(p, amount)
    if n > 0:
      emit notify { target: p.principal, unread: n }
```

Run `cargo test -p snapback4-lang --test helper_placement unbounded_optional_domains_still_need_a_page_bound_in_both_forms` from
`snapback4/` to exercise it. Both helper and inline forms report
`E_QUARRY_BOUND: members has no cap over this prefix; this position needs a bounded page`.
Optional-presence alternatives lower through ordinary page expressions; those
do not inherit the streaming loop-domain bound. The diagnostic proposes a cap
or explicit page. For a complete total without a product cap, keep the principal
domain and move the optional predicate into an `if` inside the loop. This is
existing behavior beyond the requested placement repair; it was not changed.

## Decisions, deviations and measurements

- No requested implementation was stopped or redesigned. The lane brief
  specifies these two fixes; LLP 3000.021 does not enumerate them. The new
  code includes the requested LLP 3000.019 acceptance references and the
  specific governing LLP 3000.007 §5.1/§5.2 references.
- Bounds use the existing `u32::MAX` heap-bound sentinel and saturating addition,
  matching text concatenation. Existing loop widening admits non-self-append
  concatenations whose item type stabilizes. Recursive item growth refuses;
  no arbitrary pass count or engine ceiling was increased.
- The existing `E_QUARRY_TYPE` and `E_QUARRY_SHAPE_JOIN` codes suffice. No
  `guide::CODES` or `why` entry was added.
- The guide's wording changed deliberately. Its old self-append fact and all
  existing tests were retained; no pinned test expectation or budget was raised.
- The three-total first pass is reconstructed, not recovered, as explained above.
- Rust 1.97.0, Node 24.13.1, Bun 1.3.14; eight Cargo jobs, dev/test debug info
  disabled, incremental compilation disabled, file descriptor limit 65,536.
  Frozen Bun install passed. The full suite also runs the package build.
- Same-worktree wasm before and after: **1,980,253 B raw / 571,810 B gzip**,
  **delta 0 B raw / 0 B gzip**, byte-identical SHA-256
  `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
  Unchanged budget **572,841 B**, headroom **1,031 B**.

## Required full suite

Ran `scripts/test.sh` **once**. Exact summary: **`== 1 failure(s) in 1436 s`**,
exit **1**. Its failed check was **`cargo test`**.
Rust tests/doctests report **3,825 passed / 1 failed / 24 ignored**, in **928 s**.
The only Rust failure is **ours**, `snapback4-lang::ephemeral_compat::durable_schema_and_types_keep_base_bytes`:
the new top-level fixture enlarged a frozen inventory. It is fixed by `5b81caff1`,
with the unchanged compatibility test plus both relocated-fixture consumers
passing in the targeted follow-up (9/9). This is the complete failure list;
no baseline or environmental failures were observed. The complete suite was
not rerun after the fixture-only correction. No failure remains unresolved.

Client tests passed in 197 s: main 2,481 passed / 0 failed / 10 skipped;
seven additional shards 56/56. Fixture wrapper tests passed 9/9. Native and
wasm builds, release guard, docs budget, package typecheck/build, chat check,
and both app typechecks passed. All **78/78** seeded client-model tests passed
in **258 s**. Full log: `target/lane-qe/full-suite.log`; exit status:
`target/lane-qe/full-suite.exit`; correction log:
`target/lane-qe/fixture-followup.log`.
