# Lane X — round-four repair verification

2026-09-25 · `sb4-intent/x-familiar` · parent `48e107485`.
Reviews addressed: `~/sb4-intent/reviews/x-r3.astra.md` and
`~/sb4-intent/reviews/x-r3.grok.md`.

## Result

Executable self-comparison and `count(*)` repairs now carry checked source
replacement spans. Before offering one, the compiler patches and reparses only
the affected declaration, then binds it against the project's declarations.
Other operations, actions, routes and schedules are excluded from that binding.
No recursive diagnostic compilation occurs. An empty or uncertain candidate
requires no verification work; ordinary successful compilations do not perform
repair bindings.

For a named-key repair, the compiler also binds the intended read AST in the
same declaration and compares its actual point/page class with the patched
read's class, using existing source-to-IR mappings and scan sites. The intended
AST is never printed into a repair. Parse/bind/admission errors, unavailable
proofs or a different plan class leave the refusal and explanation intact with
an empty rewrite. The ordinary compiler, engine and authorization checks remain
responsible for admitting programs.

The source edits delete a sole offending filter together with `where`, or one
conjunct together with an adjacent `and`. They preserve retained source,
including scoped nested keys, parentheses and read modifiers. Named equalities
precede the first parsed top-level seek; trailing commas are reused.

## File ledger

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/repair.rs` | New affected-declaration verification, checked patch application, schema/helper context, actual-versus-intended IR plan comparison, and three injected-bad-repair tests. |
| `crates/snapback4-lang/src/lib.rs` | Verifies executable repair candidates after the contextual type reparse and before returning refusals. |
| `crates/snapback4-lang/src/source.rs` | Retains diagnostic-only candidate spans, source and intended reads outside schema/IR/wire data. |
| `crates/snapback4-lang/src/parser.rs` | Tracks expression spans per declaration and exposes the checked splice helper internally. |
| `crates/snapback4-lang/src/parser/expr.rs` | Records operand spans, carries the complete grouped expression start and individual `where` spans, and recovers through `count(*)` without losing following declarations. |
| `crates/snapback4-lang/src/parser/predicates.rs` | Passes original read/predicate spans to key repair generation and constructs the intended predicate with exactly one conjunct removed, solely for verification. |
| `crates/snapback4-lang/src/parser/repairs.rs` | Source-only filter/conjunct removal, parsed seek insertion, balanced grouping, trailing-comma handling and candidate registration with checked offsets. |
| `crates/snapback4-lang/src/parser/programs.rs` | Supplies a chunk read's first token to the shared range parser. |
| `crates/snapback4-lang/src/bind/mod.rs` | Makes the existing syntax traversal available within the crate. |
| `crates/snapback4-lang/src/bind/intent_walk.rs` | Same visibility-only change for document traversal; no traversal or lowering behavior changed. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md` | Documents exact predicate removal and verification before a repair is offered. |
| `crates/snapback4-lang/tests/familiar_verified_repairs.rs` | Six new integration tests; actual offered repairs are pasted, compiled and executed against the native engine. |
| `crates/snapback4-lang/tests/familiar_predicates.rs` | Exact nested repair now omits `where true`; count failure includes its source; helper signature-changing repair is suppressed, while an existing-argument helper repair still pastes cleanly. |
| `crates/snapback4-lang/tests/familiar_repairs.rs` | Exact conjunct deletion and suppression of the previously documented independently invalid point-seek repair. |
| `crates/snapback4-lang/tests/familiar_source_repairs.rs` | Updates exact text while retaining round three's two-row executed scope assertion. |
| `crates/snapback4/tests/familiar/guesses.json` | CLI nested-roster fixture now matches predicate deletion. |
| `JOURNAL.md` | One dated, append-only entry for this round. |
| `reports/lane-x-round4-report.md` | This report and evidence. |

## Repairs that compile and run

Each read below is inside an enclosing `members` row shape. The fixtures seed
`a` with conversation `one`, active true, score 10; `b` with conversation `two`,
active false, score 20. Unique-key cases additionally declare `unique
conversation` and `cap 1 by conversation`.

| Guess | Offered repair | Executed result |
|---|---|---|
| `members where .id = .id` | `members[id = .id]` | Each outer row gets itself as a row, not an array; the plan says `row or null`. |
| `members where .conversation = .conversation` with a unique conversation | `members[conversation = .conversation]` | Same point-result assertion, including a cap that would have hidden the old `where true` error. |
| `members where (.id = .id) first 20` | `members[id = .id] first 20` | Each outer row gets a one-element page. |
| `(members[]) where .conversation = .conversation first 20` | `(members[conversation = .conversation]) first 20` | Balanced source; each outer row gets its own roster. Double grouping is covered too. |
| `members[active = .active,] where .conversation = .conversation first 20` | `members[active = .active,conversation = .conversation] first 20` | Valid trailing-comma insertion; both rows get their own roster. |
| `members[score >= .score] where .conversation = .conversation first 20 by byConversation` | `members[conversation = .conversation, score >= .score] first 20 by byConversation` | Equality precedes the seek; both rows are retained. All four seek operators are tested, including strict comparisons returning empty rosters. |
| `members where .active and .conversation = .conversation first 20` | `members[conversation = .conversation] where .active first 20` | `a` has its row; `b` has an empty page. First/middle/last conjuncts, grouping and repeated `where` are covered. |

The original guess replay table remains in
[the lane report](lane-x-report.md#guess-replay); the three CLI replay tests still
pass. `len`, `.length`, `count(*)` and `limit` remain refusals, and mechanical
`len` repair remains unchanged. Repeated `where`, qualified helpers, nullable
presence comparisons and both-store prediction/visibility witnesses remain in
the full suite.

## New tests and mutation evidence

| Test | What it proves |
|---|---|
| `sole_predicates_preserve_point_and_explicit_page_results` | Pasted id/unique-key repairs return rows, while explicit `first` repairs return pages; it checks both values and the point plan. |
| `grouped_reads_and_trailing_comma_keys_keep_source_and_answers` | Single/double parentheses, trailing commas and nested comparison operands preserve source and executed answers. |
| `named_equality_precedes_all_seek_operators_and_retains_other_operands` | `<`, `<=`, `>`, `>=`, existing equalities, two seeks, nested comparisons, explicit indexes and trailing commas all paste and execute. |
| `delete_only_the_bad_conjunct_at_any_position_or_where_clause` | First, middle, last, parenthesized and repeated-`where` cases remove only the offending conjunct and return the expected active roster. |
| `independent_declaration_errors_do_not_hide_a_checked_repair` | An unrelated operation with an unknown name is not bound while checking this repair. |
| `a_remaining_error_in_the_affected_declaration_suppresses_the_repair` | Unknown names and a second self-comparison in the same declaration suppress the proposed repair. |
| `broken_syntax_names_and_types_are_suppressed_before_offering` | Injected unbalanced syntax, an unknown binding and an invalid key type cannot escape verification; the refusal/message remain intact. |
| `compiling_repairs_that_change_point_or_page_class_are_suppressed` | Both point-to-page and page-to-point injected repairs compile successfully but are withheld for a changed plan. |
| `count_star_prose_is_not_a_verified_replacement` | Exact `count(members)` passes; injected `count(rows) or count(members)` does not. |

Three actual temporary mutations were built and tested, then restored in
`finally` blocks:

| Mutation | Required failure |
|---|---|
| Remove `","` from the separator condition | Exit 101 in the trailing-comma execution test: verification suppressed the doubled-comma repair instead of offering the expected valid one. |
| Remove the actual/expected class equality guard | Exit 101 in the compiling-bad-plan test: the different plan was incorrectly offered. |
| Bypass verification in the offer path | Exit 101 in the injected syntax/name/type test: broken source was incorrectly offered. |

Restored-code targeted checks: **134 language/unit/guide tests and three CLI
tests passed**. The six new integration tests took 0.32 seconds in the initial
complete targeted pass, including compilation and execution of their cases.
No runtime meters or budgets were adjusted.

## Compatibility, decisions and remaining limitations

- No new spelling, refusal code, engine/store behavior, authorization,
  disclosure, durability, prediction or meter path changed. No files owned by
  lanes U/V, package versions, remote branches or publication state changed.
- Verification applies to the lane's concrete self-comparison and `count(*)`
  source edits. Existing diagnostics that provide general design advice retain
  their existing behavior; this change does not attempt to compile prose.
- Schema declarations and helpers are dependency context; unrelated operations
  are not rebound. A named-key candidate requires two isolated bindings to
  compare actual plans. Non-key candidates need one.
- Standalone shape declarations without an instantiated focal type and helper
  signature changes have no complete proof within one affected declaration.
  Those repairs are withheld. Existing-argument helper repairs remain checked
  via a synthetic typed query. This prevents a new helper argument from
  breaking an unchanged `choose()` call elsewhere.
- The exact seek-operand probe `exists members[active >= (.active = .active)]`
  has an independent point-seek error. It still refuses the self-comparison,
  now without a broken repair. Its bounded-page counterpart still repairs and
  compiles. Nullable aggregate ordering retains its existing restriction.
- Several errors in one declaration may require manual correction: a patch
  leaving another error gets no rewrite. The tests preserve the refusal and
  explanation for this case.

These are conservative applications of the requested verification rule, not
new accepted-language restrictions. No unresolved round-four finding or design
deviation. The existing full-suite 60-second wall-time budget remains exceeded
on this shared host; no tests or thresholds were reduced.

## Guide word counts and fact mapping

Rendered counts are unchanged in this round. The same baseline opening
boundaries and whitespace-delimited counting method are used as round zero.

| Card | Words before → after | Opening before → after |
|---|---:|---:|
| language | 5,686 → 4,798 | 4,059 → 128 |
| programs | 1,266 → 478 | 627 → 135 |
| reads | 3,933 → 1,843 | 1,715 → 168 |
| shapes | 1,415 → 537 | 1,415 → 93 |
| writes | 3,987 → 2,037 | 3,987 → 211 |
| types | 2,013 → 729 | 737 → 125 |
| **Total** | **18,300 → 10,422 (43.0% reduction)** | **12,540 → 860 (93.1% reduction)** |

All six openings remain reduced by at least two thirds. All **133 moved fact
homes** and **17 original compiled blocks** still pass their reachability/hash
tests. The complete mapping is unchanged in
[the original report](lane-x-report.md#moved-fact-mapping) and
[the checked manifest](../crates/snapback4-lang/tests/fixtures/guide-fact-homes.json).

| Round-four fact | Home |
|---|---|
| Delete the sole filter or one conjunct; preserve all retained source | `why E_QUARRY_SELF_EQUALITY` |
| Insert a named equality before seeks | Same `why` page |
| Verify patched declaration and intended point/page class before offering a repair | Same `why` page |
| Withhold uncertain/invalid repairs, retain refusal and explanation | Same `why` page |

Rendered `why E_QUARRY_SELF_EQUALITY`: **2,583 UTF-8 bytes**, below 4,096.
`./ref-check --verbose`: **509 LLP documents, 9,282 refs, zero errors and zero
unchecked**. External `~/sb4-intent/target-clique.q`: check exit 0, zero problems,
six existing notes. The largest changed source file is `parser.rs`, **1,220
lines**, below 1,500. Frozen Bun installation changed no dependencies.

## Full validation

One full `scripts/test.sh` run, exit **0**, exact final summary:

```text
== 0 failure(s) in 469 s
```

Every blocking phase passed. Client tests: **1,519 total, 1,509 passed, ten
existing skips**; client models: **78 passed**, retaining all **5,000 online
session / 5,000 local session / 3,000 online client sequences**. The both-store
familiarity witness passed. Wasm remains **1,775,799 B raw / 495,258 B gzip**,
under the unchanged **496,000 B** budget.

Final failures: **ours 0; baseline 0; environmental 0**. There were no full-suite
failures to waive or retry.

Development failures were ours and resolved: the initial `BoundProgram`
instrumentation lacked an action constructor field (that instrumentation was
removed in favor of existing IR/source data); one test used `clone` instead of
`to_vec` for a value slice; initial span tracking omitted left operands; error
recovery lost tables after `count(*)`; one seek fixture needed an explicit index
covering its two equality keys; old exact `where true` and independently invalid
seek expectations needed updating. The deliberate mutant failures above are
negative-test evidence, not final failures. None was waived as baseline or
environmental. The supplied baseline log was read before attributing failures.

Implementation commit: **`3c3a69461`**. This report and the dated journal entry
are committed separately. Both commits have the required co-author trailer.
No push or publication was performed.

Raw evidence remains on this host:

| Log | SHA-256 |
|---|---|
| `/tmp/lane-x-r4-suite.log` | `5729a539a4a7cf11311e104e503f272665ed4c90ad56ea8e4441c750d702868f` |
| `/tmp/lane-x-r4-lang-final.log` | `dca6ca8912c981684c617bf483c2ac884848b630d88b8b2a472d9041f7ca5f62` |
| `/tmp/lane-x-r4-cli-final.log` | `ac8a9a2c8bf1d94bc72fc0f633309c50c23783d03e225dccf3e6a480fa726e19` |
| `/tmp/lane-x-r4-mutant-comma.log` | `715c0cd28de87ff6b147b62edca75c39af33274188e1feb878f99952e9784f92` |
| `/tmp/lane-x-r4-mutant-class.log` | `00fb9af193eb52999498d9915c9950714811c2630e4648924864a27b18ef5ec6` |
| `/tmp/lane-x-r4-mutant-verification.log` | `64e36ad9795ea0ebbf0bfc592709d1e3c8caaccc5d10a602590734a633e45175` |
| `/tmp/lane-x-r4-ref-check.log` | `1e5140cf42ac528e8dd1789fb0fc1d1c39c4a9b76f6f5e0f0cc36413cf664690` |
| `/tmp/lane-x-r4-target.log` | `ee04344434701b84baff2df118527dcc8aae6c809237380456486f9bf6bfa86c` |
| `/tmp/lane-x-r4-why.log` | `e0d9b85483ee2ae6db096b023a0bd92c59e269745d9a4229968ebc9b6b3a3c31` |
| `/tmp/lane-x-r4-bun.log` | `fc7a7b2f5f9d70bdc9383a56825410a0f3b2bc62fbd45807340ea4663aff34d6` |
