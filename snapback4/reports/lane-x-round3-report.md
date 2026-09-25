# Lane X — round 3 delta-review repairs

Date: 2026-09-25. Branch: `sb4-intent/x-familiar`.
Reviews: `~/sb4-intent/reviews/x-r2.astra.md` and
`~/sb4-intent/reviews/x-r2.grok.md`.

Both findings are fixed. Self-comparison repairs edit the author's source;
they do not reprint retained expressions. Both requested surviving mutations
were run and caught. A third mutation reproduced Astra's scope change and
failed the execution assertion with zero roster rows instead of one.

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/parser.rs` | Adds declaration-local comparison token spans and clears them at the next declaration. This is parser-only metadata, absent from schema, IR and device payloads. |
| `crates/snapback4-lang/src/parser/expr.rs` | Records each comparison's exact token range when parsed, before subsequent operators or grouping can obscure its span. |
| `crates/snapback4-lang/src/parser/predicates.rs` | Uses source splices for argument, constant and named-key repairs. Removes AST cloning/replacement and expression printing from these repairs. Retains the type-equality, bound and top-level-conjunct checks. |
| `crates/snapback4-lang/src/parser/repairs.rs` | Shares token-derived declaration boundaries with fresh-name selection. Scans `word =` bindings at every depth, excluding names preceded by `.`, within this declaration only. Provides checked comparison/predicate/declaration/read splices. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_SELF_EQUALITY.md` | Explains source preservation, key/parameter insertion, the explicit `true` replacement, and fresh-name scope. |
| `crates/snapback4-lang/tests/familiar_source_repairs.rs` | Four new tests: executed scope repair, source-preserving argument repairs, nested/current-declaration binding names, and same-named columns with different types. |
| `crates/snapback4-lang/tests/familiar_predicates.rs` | Expects the original read's clause order and the comparison-only `true` replacement. All previous operator/paste tests remain. |
| `crates/snapback4-lang/tests/familiar_repairs.rs` | Updates two exact expectations to preserve authored order and parentheses instead of printer-generated normalization. |
| `crates/snapback4/tests/familiar/guesses.json` | Nested-roster repaired fixture follows the emitted source edit, retaining `where true`, page size and order. |
| `packages/snapback4/test/familiar-forms.test.mjs` | Adds a pure `.due <= .due` presence query with an explicit result assertion online and offline on wasm/memory and native/SQLite. |
| `JOURNAL.md` | One dated append-only round-three entry. |
| `reports/lane-x-round3-report.md` | This report, compatibility decisions, examples, test evidence and measurements. |

## Actual repairs and results

Astra's exact nested predicate retains this expression unchanged:

```text
count(members[conversation = .id] first 20 by .active) > 0
```

The outer read's repair is:

```text
members[conversation = .conversation] where true and count(members[conversation = .id] first 20 by .active) > 0 first 20
```

Pasting it into the review's outer members shape and executing rows
`(id=a, conversation=one)` and `(id=b, conversation=a)`, both active, gives
`a` a roster containing `a`; `b` has an empty roster. The same assertion covers
insertion into `members[]` and an existing `members[active = .active]` key list.

Argument repairs also preserve nested key scope. Both an existing `active: bool`
argument and an added argument change only `.active = .active` to
`.active = active`. A retained multiline nested key, its comment, grouping and
ordering remain unchanged. Executing either pasted repair returns only `a`.

| Probe | Result |
|---|---|
| Grok's `if true:` containing `active = false`, followed by the bad member filter | Adds `activeArgument: bool`; the nested local remains unchanged and the pasted declaration compiles. |
| A deeper block binds both `active` and `activeArgument` | Adds `activeArgumentArgument: bool`; the repair compiles. |
| Only a later operation binds `active` or `activeArgument` | Adds `active: bool` to the current operation; later bindings do not change its name or enter its replacement. |
| Outer `members.active: bool`, inner `notes.active: text <=80` | Uses the whole-query argument fallback with `active: text <=80`; it does not invent a bool-valued key for the inner text column. The actual repair compiles. |
| `tasks where .due <= .due first 20 by .title after c { title }` with `due: time ?` | Returns only `{title: 'dated'}` online and on both offline stores. No disjunct can retain the undated row. |

## Tests and mutation evidence

`familiar_source_repairs.rs` adds:

1. `nested_key_repair_preserves_the_reviewers_two_row_answer`: compiles and
   executes the actual emitted repair against Astra's two-row counterexample;
   checks the answer before checking exact source preservation; also covers
   empty and existing key lists.
2. `argument_repairs_splice_only_the_comparison_and_keep_nested_source_and_results`:
   existing/new arguments preserve the rest of a multiline predicate verbatim,
   including a named key, comment and grouping; both executed repairs return `a`.
3. `fresh_parameters_consider_nested_bindings_only_in_the_current_declaration`:
   bindings at two nested depths cause collision avoidance; later declarations
   do not; every exact replacement is compiled in its original context.
4. `same_named_columns_with_different_types_use_the_argument_fallback`:
   bool versus text requires the argument repair, which compiles.

The existing device witness now exercises pure inclusive comparisons in both
directions. It retains the rule-filtered owner/foreign prediction checks and
qualified helpers in guarded updates from earlier rounds.

| Temporary mutation | Test that fails | Observed failure |
|---|---|---|
| Replace exact column-type equality with enclosing-column existence | `same_named_columns_with_different_types_use_the_argument_fallback` | Exit 101: emitted `notes[active = .active] where true first 20` instead of the typed argument fallback. |
| Remove only `Lte` from the ordered-comparison null-guard lowering | `familiar-forms.test.mjs` | Mutant builds; exit 1: wasm returned both `dated` and `undated` instead of only `dated`. |
| Change the retained `[conversation = .id]` into an inner `where .conversation = .id` | `nested_key_repair_preserves_the_reviewers_two_row_answer` | Exit 101 at the executed answer: roster length 0 instead of 1. The mutated repair still compiled. |

Every mutation was restored in a `finally` block. Correct-code targeted tests
were rerun afterward. Neither the binder nor the runtime has a committed change.

## Engineering decisions, deviations and remaining problems

- A key repair inserts the necessary key and replaces just the offending
  comparison with `true`. It does not remove conjunctions or normalize clause
  order, whitespace, comments, parentheses or any retained expression. This
  intentionally changes old exact-rewrite expectations without changing the
  intended repaired query's selection.
- Argument repairs insert a parameter only when necessary and replace only the
  offending comparison. Printing the new parameter's scalar type does not
  reprint any retained expression.
- Fresh-name scanning follows the requested token rule literally: a word
  followed by `=`, not preceded by `.`, at any depth in the current declaration.
- Existing checked-offset behavior remains: an uncertain source span has no
  replacement. No repair is newly mechanical; `check --fix` behavior is retained.
- No new syntax, refusal code, limit, authorization, disclosure, durability,
  store-format, meter or client-source behavior was introduced. No files owned
  by lanes U/V, package versions, publication state or remote branches changed.

No deviation from the round-three brief and no unresolved finding. The existing
optional-aggregate and point-seek restrictions recorded in the round-two report
remain unchanged. The shared-host suite continues to exceed its existing
60-second wall-time budget; no test count or budget was reduced.

## Guide measurements and mapping

The six core cards are unchanged this round. All 133 fact homes and all 17
original compiled blocks remain covered by passing guide tests.

| Card | Words before → after | Opening before → after |
|---|---:|---:|
| language | 5,686 → 4,798 | 4,059 → 128 |
| programs | 1,266 → 478 | 627 → 135 |
| reads | 3,933 → 1,843 | 1,715 → 168 |
| shapes | 1,415 → 537 | 1,415 → 93 |
| writes | 3,987 → 2,037 | 3,987 → 211 |
| types | 2,013 → 729 | 737 → 125 |
| **Total** | **18,300 → 10,422 (43.0% reduction)** | **12,540 → 860 (93.1% reduction)** |

Each opening exceeds the two-thirds reduction target. The full
[original fact mapping](lane-x-report.md#moved-fact-mapping) remains unchanged.
The new source-splice and fresh-name facts are reachable through
`why E_QUARRY_SELF_EQUALITY`; every why page remains within 4,096 bytes.
The original [guess replay table](lane-x-report.md#guess-replay) still applies,
with the nested-roster replacement updated to preserve the original source.

## Verification

- Restored-code language/unit/guide tests: **20 + 6 + 6 + 6 + 4 + 83 = 125 passed**.
- CLI familiar replay and paste tests: **3 passed**.
- Offline witness: **1 passed**, exercising wasm/memory and native/SQLite.
- `bun install --frozen-lockfile`: no dependency changes.
- External `~/sb4-intent/target-clique.q`: exit 0, zero problems, six existing notes.
- `./ref-check --verbose`: 509 LLP documents, 9,282 refs, zero errors/unchecked.
- `why E_QUARRY_SELF_EQUALITY`: 2,250 rendered UTF-8 bytes, within 4,096.
- Wasm: **1,775,799 B raw / 495,258 B gzip**, unchanged 496,000 B budget.
- No changed source file exceeds 1,500 lines.

Development failures, all **ours** and resolved before final validation:
the first targeted run retained one obsolete expected repair in
`every_self_comparison_refuses_in_top_level_and_nested_filters_and_repairs_paste`;
it now expects the source-preserving `where true`. The new execution test file
initially treated three `Value::field` results as `Option` rather than `Result`;
correcting those assertions resolved the compilation errors. No production
failure was waived as baseline or environmental. The three deliberate mutant
failures above are negative-test evidence.

Full default-concurrency `scripts/test.sh` ran once and exited 0:
**`== 0 failure(s) in 418 s`**.
All blocking phases passed. Client tests: **1,519 total, 1,509 passed, ten
existing skips**. Client models: **78 passed** with all 5,000 online-session /
5,000 local-session / 3,000 online-client sequences retained.
Final failures: **ours 0, baseline 0, environmental 0**.

Implementation commits: `f11ab00fd` (source repairs, scoped fresh names, guide
and Rust regressions) and `0451cd389` (pure `<=` device witness). Both have the
required co-author trailer. The report and journal are committed separately.
No push or publication was performed.

Raw logs remain on this host; SHA-256 binds their contents:

| Log | SHA-256 |
|---|---|
| `/tmp/lane-x-r3-suite.log` | `896db1c386f0b227a17ecaf3455a1641bdeb3991f9610f18f78916d37d701f63` |
| `/tmp/lane-x-r3-lang-final.log` | `24bfce90c90d76c535cb636c3c55fb3a29a6b09c91ff4df8e1d8fd54aeaa8023` |
| `/tmp/lane-x-r3-cli-final.log` | `2503c63c962d0c18959846cf3919f9da98e72277a27e578ac7cf3ca4ed28c0a2` |
| `/tmp/lane-x-r3-stores-final.log` | `d5d7e0937645b47db608b2b717cf2df93d782c3fe00258a374df2ed3a9ccb684` |
| `/tmp/lane-x-r3-mutant-types.log` | `99be3cd749bb7b56d2c47626f4f2e88921637a3df90c3552e49a0fb82b022b1e` |
| `/tmp/lane-x-r3-mutant-lte.log` | `a27d06caf2838d3e2a45f636c7aa2fa78331402e8004805e0f0bfaf7b702d2ca` |
| `/tmp/lane-x-r3-mutant-scope.log` | `cbd67a7fe8206f756e1fce129d59d55f0037ebb795eeb1b37773077164b13de5` |
| `/tmp/lane-x-r3-ref-check.log` | `fda29006e95642c0a935f41f3f659ad3039b73f33a0e1ff0cb1e02d1bd8257fd` |
| `/tmp/lane-x-r3-target.log` | `9553fc44fc16997e42bcbb32bd6fdb2a02e660ed2ae207a3540b9da79de15d00` |
| `/tmp/lane-x-r3-why.log` | `363e170d098f2fd6b88333d12e649f88db5715dc8653e3b63221fddea1f7c422` |
