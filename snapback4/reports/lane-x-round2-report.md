# Lane X — round 2 delta-review repairs

Date: 2026-09-25. Branch: `sb4-intent/x-familiar`.
Reviews: `~/sb4-intent/reviews/x-r1.astra.md` and
`~/sb4-intent/reviews/x-r1.grok.md`.

All reported round-two defects are fixed. The three requested source mutations
were run and each failed its designated regression test. No engine, store,
authorization, disclosure, durability, meter, client-source, Following, version,
publication or push change was made.

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/parser/repairs.rs` | New checked source-edit helpers. Declaration boundaries use layout tokens and balanced delimiters; token offsets account for Unicode and escaped strings. Invalid, overlapping or uncertain spans have no rewrite. Resolves table and inferred projected-view scalar types without an `id` fallback. |
| `crates/snapback4-lang/src/parser.rs` | Tracks the current declaration's starting token and accepts inferred view types during the diagnostic reparse. |
| `crates/snapback4-lang/src/parser/predicates.rs` | Preserves optional `<=`/`>=`; checks required columns and all other self-comparisons as before. Finalizes nested-key repairs only after reading all clauses, checks the enclosing column and bounds, and preserves other conjuncts, page size and ordering. Ambiguous count-star has no prose replacement. |
| `crates/snapback4-lang/src/parser/expr.rs` | Finalizes repairs after range parsing; ambiguous `count(*)` explains the missing domain in its message. |
| `crates/snapback4-lang/src/lib.rs` | Diagnostic reparse uses the ordinary binder's projected-view types from a discarded declaration-only binding. Later declarations/files remain supported. Final compilation still uses the normal binder and all existing rules. |
| `crates/snapback4-lang/src/guide/shapes.rs` | Documents the optional inclusive-comparison exception in the closing limit. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md` | Documents presence semantics, the existing aggregate restriction, safe nested repair eligibility, preserved clauses, inferred view types and omission of uncertain repairs. |
| `crates/snapback4-lang/tests/familiar_predicates.rs` | The existing nested-repair expectation now requires retention of `first 50`. |
| `crates/snapback4-lang/tests/familiar_repairs.rs` | Six round-two regression tests; details below. |
| `crates/snapback4/tests/familiar.rs` | Exact count-star equality and a check that the next CLI invocation pastes the actual emitted rewrite. |
| `crates/snapback4/tests/familiar/guesses.json` | Count-star is exercised in an unambiguous members scope; the nested-roster repaired fixture retains its page and order. |
| `packages/snapback4/test/familiar-forms.test.mjs` | Offline nullable-presence queries and predictable updates with `m.twice` in `Write.condition`, on wasm/memory and native/SQLite. |
| `JOURNAL.md` | One dated append-only entry for this round. |
| `reports/lane-x-round2-report.md` | This report, measurements, compatibility decisions and evidence. |

## Forms and actual repairs

The tests compile the actual diagnostic replacement, not a separately written
approximation. Repairs still require intent and are never mechanical fixes.

| Probe / form | Result |
|---|---|
| Multiline `where (` newline `.active = .active` newline unindented `)` | Located `E_QUARRY_SELF_EQUALITY`, no panic. Adds `active: bool`, repairs the predicate, and preserves the entire declaration and its paging/shape clauses. |
| `tasks where .due >= .due first 20 after c` with `due: time ?` | Compiles; online and both offline stores return only the dated row. |
| `tasks where .due <= .due or .title = title first 20 after c` | Compiles; the named undated row remains visible through the other disjunct. |
| `tasks where exists tasks[open = (.due >= .due)] first 20 after c` | Compiles; the key operand keeps the enclosing task's nullable presence semantics. |
| Required-column `<=`/`>=`; optional `=`, `!=`, `<`, `>`, `in [.due]` | Still receive `E_QUARRY_SELF_EQUALITY`. |
| Uncapped nested roster with `.active and .conversation = .conversation first 20` | Repairs to `members[conversation = .conversation] first 20 where .active`. Column and explicit-index ordering are retained when present. |
| `notes where .body = .body first 20` in a members shape lacking `body` | Whole-query repair adds `body: text <=80` and compares with it; no invalid enclosing key. |
| Unpaged `count(members where .conversation = .conversation)` without a cap | Repairs the predicate to use the existing argument, retaining the meter-bound count. Does not invent an unbounded key read. |
| `activeMembers where .active = .active first 20 after c` | Uses the view's inferred `bool` type. Renamed and computed boolean projections also repair and compile. |
| `update predictedNotes[id] { value: 21 } if m.twice(x) = 14` | A `predicts` mutation compiles and predicts offline on both stores. With `x = 7`, local value becomes 21; `x = 6` fails and leaves it unchanged. |
| Scoped `count(*)` | Exact rewrite `count(members)` compiles through CLI `check`; prose alternatives fail the fixture. |
| `count(*)` with two tables and no focal table | Refusal asks the author to name the domain; replacement text is empty rather than a non-program choice list. |

## Tests and mutation evidence

`familiar_repairs.rs` adds:

1. `multiline_repair_uses_tokens_and_preserves_the_whole_declaration`: the
   unindented closing delimiter, LF/CRLF, Unicode/escaped strings, EOF versus a
   following declaration, actual pasted repair, and uncertain-delimiter fallback.
2. `optional_inclusive_comparisons_preserve_presence_in_early_late_and_other_modules`:
   both inclusive operators in reads and nested keys; tables before/after/in
   another module; preserved aggregate refusal; all other optional operators.
3. `nested_key_repairs_keep_conjuncts_bounds_and_order`: uncapped roster,
   repeated `where`, column/index order, unrelated enclosing table, and unbounded
   key fallback. Every repair is pasted and compiled.
4. `projected_view_repairs_use_inferred_field_types`: bare, renamed and computed
   boolean projections in another file; actual typed repairs compile. An
   optional projected date preserves its inclusive presence test.
5. `seek_operands_are_checked_in_the_enclosing_predicate_scope`: Astra's exact
   `exists members[active >= (.active = .active)]` receives the intended refusal.
   A supported paged seek also compiles after the actual argument repair.
6. `ambiguous_count_star_refuses_without_prose_in_the_replacement`: no invented
   table or non-program alternatives when the counted domain is ambiguous.

The unit test in `parser/repairs.rs` rejects out-of-range, reversed, overlapping
and non-UTF-8-boundary edit ranges, and accepts a valid Unicode edit.

The device witness uses the existing real CLI/server, disables transport after
acquisition, inspects predicted outbox rows, and reads through the local rules.
It retains the owner-visible and foreign-hidden predicted-row assertions and
confirms offline inserts/updates never reached the server. Presence-query
results are also compared with explicit expected rows online and on both stores.

| Temporary source mutation | Regression that fails | Observed result |
|---|---|---|
| Remove `for seek in &read.seeks { visit(&seek.value); }` | `seek_operands_are_checked_in_the_enclosing_predicate_scope` | Exit 101: missing `E_QUARRY_SELF_EQUALITY` on the exact reviewer probe. |
| Remove `Write.condition` traversal in `intent_walk.rs` | `familiar-forms.test.mjs` | Mutant builds; test exits 1 because the guarded mutation's `m.twice` remains unresolved (`E_QUARRY_UNKNOWN`). |
| Emit `count(rows) or count(members)` | CLI `builder_guesses_have_one_step_check_repairs` | Exit 101 at exact equality: expected `count(members)`. |

Each source mutation was restored in a `finally` block. Correct-code targeted
checks were rerun afterward; no mutant is present in the commits.

## Compatibility decisions, deviations and remaining limits

No requested feature was dropped and no authorization or resource-bound design
was changed. Two pre-existing restrictions are preserved rather than broadened:

- Optional ordered aggregate operands already fail with `E_QUARRY_MAINTAIN`.
  Verified against the saved `f5efae87f` binary and the new compiler with:
  `table tasks` containing `due: time ?`, `title: text <=80`, `public`, followed
  by `view counts: count tasks where .due >= .due by .title`. Both report
  `maintain comparison needs compatible scalar types; got time ? and time ?`.
  This round removes the erroneous self-comparison refusal/constant repair;
  it does not change aggregate admissibility. The `<=` case is also tested.
- Point probes with seek operands already fail independently of this lane.
  After removing the self-comparison from Astra's seek probe, its point seek
  still needs a supported read form. The exact probe locks refusal traversal;
  the paged-seek variant provides the compiling repair witness.

Engineering choices where the brief is silent: uncertain repair types/spans and
ambiguous count domains have empty replacement text; nested key repairs require
matching column types and a known bound, and only extract a top-level conjunct.
Projected types come from the existing binder, not a second inference system.
The original count-star fixture now has an explicit members scope, while the
old ambiguous situation has its own refusal test.

No unresolved round-two finding. The existing 60-second suite wall-time budget
remains exceeded on this shared host; no test counts or budgets were reduced.

## Guide measurements and fact mapping

Counts use whitespace-delimited rendered-card words, including examples, with
the same frozen opening boundaries as round zero. The extra shapes-limit wording
adds two words compared with round one.

| Card | Words before → after | Opening before → after |
|---|---:|---:|
| language | 5,686 → 4,798 | 4,059 → 128 |
| programs | 1,266 → 478 | 627 → 135 |
| reads | 3,933 → 1,843 | 1,715 → 168 |
| shapes | 1,415 → 537 | 1,415 → 93 |
| writes | 3,987 → 2,037 | 3,987 → 211 |
| types | 2,013 → 729 | 737 → 125 |
| **Total** | **18,300 → 10,422 (43.0% reduction)** | **12,540 → 860 (93.1% reduction)** |

Every opening remains reduced by at least two thirds. All 133 original fact
homes and all 17 original compiled blocks are preserved and tested. The full
[fact-by-fact mapping](lane-x-report.md#moved-fact-mapping) and
`crates/snapback4-lang/tests/fixtures/guide-fact-homes.json` remain unchanged.

| Round-two clarification | Reachable home |
|---|---|
| Optional inclusive comparison preserves presence; aggregates keep their restriction | `why E_QUARRY_SELF_EQUALITY`; shapes closing limit |
| Matching enclosing column, top-level conjunct, bounded read, preserved filter/page/order | `why E_QUARRY_SELF_EQUALITY` |
| Inferred projected type; uncertain type or span has no replacement | `why E_QUARRY_SELF_EQUALITY` |

## Verification

- Language regressions plus guide: **6 + 6 + 6 + 83 = 101 passed**.
- Language unit tests: **20 passed**, including checked-splice safety.
- CLI familiar replay and paste tests: **3 passed**.
- Offline witness: **1 passed**, exercising wasm/memory and native/SQLite.
- `bun install --frozen-lockfile`: no dependency changes.
- External `~/sb4-intent/target-clique.q`: exit 0, zero problems, six existing notes.
- `./ref-check --verbose`: 509 LLP documents, 9,282 refs, zero errors/unchecked.
- Wasm: **1,775,799 B raw / 495,258 B gzip**, unchanged 496,000 B budget.
- No changed source file exceeds 1,500 lines.

During targeted development there were six **introduced** test failures, all
fixed before the final targeted runs and full suite:

| Failure | Cause and resolution |
|---|---|
| `familiar_predicates::no_argument_repairs_add_a_typed_argument_without_losing_the_body` | Fresh-name collision scan included table column declarations. Restricted the scan to assignment bindings. |
| `familiar_predicates::repairs_use_late_and_other_module_column_types_and_preserve_quoted_tails` | Same fresh-name regression; same fix. |
| `familiar_predicates::nested_read_keys_keep_the_enclosing_predicate_scope` | Same fresh-name regression; same fix. |
| `familiar_predicates::every_self_comparison_refuses_in_top_level_and_nested_filters_and_repairs_paste` | Old expectation deliberately dropped `first 50`; updated to require retaining it. |
| `familiar_repairs::nested_key_repairs_keep_conjuncts_bounds_and_order` | New exact assertion omitted the printer's valid parentheses; corrected expected text. |
| `familiar_repairs::seek_operands_are_checked_in_the_enclosing_predicate_scope` | New paste check assumed point seeks were supported; retained the exact refusal probe and added a supported paged-seek paste witness. |

The three deliberate mutant failures above are expected negative-test evidence.
No development failure was waived as baseline or environmental. A final ref-check
invocation mistakenly used `snapback4/` as its working directory and reported
570 missing-LLP references (ours: invocation error). Running the same command
from the repository root passed; no reference or source change was needed.

Full default-concurrency `scripts/test.sh` completed once, exit 0:
**`== 0 failure(s) in 423 s`**.
All blocking phases passed. Client tests: **1,519 total, 1,509 passed, ten
existing skips**. Client models: **78 passed** with 5,000 online-session /
5,000 local-session / 3,000 online-client sequences retained.
Final failures: **ours 0, baseline 0, environmental 0**.

Implementation commits: `f4e0ca9fa` (parser, repairs, types, guide and regressions)
and `de9a93ebb` (exact CLI repairs and both-store witnesses). Both include the
required co-author trailer. The report and journal are committed separately;
no push or publication was performed.

Raw logs remain on this host; SHA-256 binds their contents:

| Log | SHA-256 |
|---|---|
| `/tmp/lane-x-r2-suite.log` | `9d130527716c443efa22c1d8f2b45c6e79ea35622fb2d50526b4c67ec96767e4` |
| `/tmp/lane-x-r2-lang-final.log` | `2297bc59de860618554a8ec7dfc6e5345c33529473149dc90dd3115c9dc5f605` |
| `/tmp/lane-x-r2-cli-final.log` | `83776bbdbf95482e3960c0cb97a7f024bf0f0819852cf239ff4b27e64c4ad96b` |
| `/tmp/lane-x-r2-stores-final.log` | `616966fa7cfb250b1ad88f7fba9975b43aed14f3af8e2ef45f3b7d5010359c38` |
| `/tmp/lane-x-r2-final-repairs.log` | `aa980a9c459addae1b6b4dcd53ceaf2c0b37278b5cfee3ac0e0f773cd6bab71b` |
| `/tmp/lane-x-r2-mutant-seek.log` | `a0546ecaaa39cfd0ebc6a9b9cf6a357daaf89aabc0a75089308fa9d662084d68` |
| `/tmp/lane-x-r2-mutant-count.log` | `a597a88122783f3da901f269f5be404da1e8a9e23910db4ad4422eac70a4a359` |
| `/tmp/lane-x-r2-mutant-condition.log` | `f2125e59ee508f1ce89ff8d6c50c491b08fb01b0b156ddda3899f26f18fa817f` |
| `/tmp/lane-x-r2-ref-check.log` | `6091a3fdaab3e8a46e64531c307c92e06dbe1748db41fbd3653766aeaf2fdec2` |
| `/tmp/lane-x-r2-target.log` | `dc2e2bb19247b70162ab880ab5a974b8d496b6abd4bca46af7bb6e55eca9016f` |
