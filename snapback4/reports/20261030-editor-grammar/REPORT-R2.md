# LLP 3000.041 — review fixes, round 2

2026-10-30. Final fix round, based on `f5abc83967` (round 1), after chunks A
and B. **No commit or staging operation was performed.** All six lane items
are fixed; the orchestrator owns the commit. This report follows REPORT-R1's
per-finding verdict, regression and red/green evidence format.

## Scope and constraints

The read-only `llp-orient` pass covered the Snapback 4 command sheet, LLP 3000,
LLP 2000.000, LLP 3000.041 §§2.1–2.4/8/10, the security guide, the lexer and
parser, local RULES/NOT-DOING/JOURNAL, both round-2 reviews, and REPORT-R1.
The source invariance check confirms that **all 14 parser production prefixes
are byte-identical to the base**. Only `reserved.rs`'s test module changes in
Rust source. The census uses exact dev-dependency pins `proc-macro2 = 1.0.107`
and `syn = 2.0.119`, versions already in Cargo.lock; the lock adds only those
two dependency edges. No runtime dependency or language acceptance changes.

Node commands used the existing Node 24.19.0 runtime at
`/Users/ccheever/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
Bun is 1.4.2; the editor dependencies remain pinned. Direct tree-sitter tests
used `XDG_CACHE_HOME=/tmp/quarry-r2-tree-sitter-cache`; the fence uses its own
temporary cache. No global install, other machine, clone or delegated agent
was used. Existing review artifacts were left untouched.

## Per-finding evidence

Full raw outputs are in [r2-logs](./r2-logs/). Items 1–3 were tested before
repair. Items 4–6 also have final-test controls: removing binary forwarding or
restoring HEAD's wrapper reproduces the failures, and the repaired bytes were
restored exactly before the green replay. The green required-suite results
below used the final implementation. No known base red occurred.

### 1 — MUST: every production string literal, not Rust comparison idioms

**Verdict: fixed.** Removed the hand-written Rust tokenizer, neighbour rules,
`matches!` collector, and all three idiom witnesses. A recursive Rust token-tree
walk visits every literal, including inside macros; `syn::LitStr::value()`
decodes raw strings and escapes. Per-file production prefixes stop before
`#[cfg(test)]`. The candidate predicate is exactly `[a-z_][a-z0-9_]*`, the
lexer's `HYPHENATED_WORDS`, or `KB`/`MB`/`GB`. Unrecognized punctuation,
uppercase codes, mixed-case identifiers, and multiword prose are ignored.
Every candidate must occur in exactly one class or the documented allowlist;
duplicate classes, duplicate exceptions, stale exceptions, and omitted parser
modules fail.

The allowlist grows **48 → 78**. The 30 additions are 18 guide-card names,
one diagnostic rewrite placeholder (`column`), and 11 suggested replacement
identifiers. Each group has its reason at the list. No editor class grows.
The actual census reports **14 files, 261 candidates, 183 editor spellings,
78 exceptions**. Strings in guards are intentionally included; they are no
longer inferred to be keyword comparisons.

Tests: `literal_census_sees_inline_array_membership`,
`literal_census_sees_guard_strings`,
`literal_census_keeps_all_word_shaped_literals`, and
`every_parser_candidate_word_has_one_editor_class` in `parser/reserved.rs`.
The inline membership and general literal witnesses fail on the old scanner;
the guard witness already passed there and now pins the intentional
all-literals behavior. The redesigned census initially failed on all 30 newly
observed non-keywords before their documented entries were added.

Red tails:

`1-red.log`:

```text
test parser::reserved::editor_tests::literal_census_sees_guard_strings ... ok
test parser::reserved::editor_tests::literal_census_sees_inline_array_membership ... FAILED
test parser::reserved::editor_tests::literal_census_keeps_all_word_shaped_literals ... FAILED

failures:

---- parser::reserved::editor_tests::literal_census_sees_inline_array_membership stdout ----

thread 'parser::reserved::editor_tests::literal_census_sees_inline_array_membership' (365164114) panicked at crates/snapback4-lang/src/parser/reserved.rs:269:9:
assertion failed: compared_words(r#"if ["unclassified"].contains(&token.value.as_str()) {}"#).contains("unclassified")
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

---- parser::reserved::editor_tests::literal_census_keeps_all_word_shaped_literals stdout ----

thread 'parser::reserved::editor_tests::literal_census_keeps_all_word_shaped_literals' (365164112) panicked at crates/snapback4-lang/src/parser/reserved.rs:277:9:
assertion `left == right` failed
  left: {}
 right: {"KB", "_private", "escaped", "raw_word", "until-revoked"}


failures:
    parser::reserved::editor_tests::literal_census_keeps_all_word_shaped_literals
    parser::reserved::editor_tests::literal_census_sees_inline_array_membership

test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 218 filtered out; finished in 0.00s

error: test failed, to rerun pass `-p snapback4-lang --lib`
```

`1-census-initial.log`:

```text
---- parser::reserved::editor_tests::every_parser_candidate_word_has_one_editor_class stdout ----

thread 'parser::reserved::editor_tests::every_parser_candidate_word_has_one_editor_class' (365259694) panicked at crates/snapback4-lang/src/parser/reserved.rs:240:9:
parser sources: actions needs exactly one editor class or a documented non-keyword exception
parser sources: addition needs exactly one editor class or a documented non-keyword exception
parser sources: assets needs exactly one editor class or a documented non-keyword exception
parser sources: author needs exactly one editor class or a documented non-keyword exception
parser sources: capacity needs exactly one editor class or a documented non-keyword exception
parser sources: change needs exactly one editor class or a documented non-keyword exception
parser sources: column needs exactly one editor class or a documented non-keyword exception
parser sources: feeds needs exactly one editor class or a documented non-keyword exception
parser sources: imports needs exactly one editor class or a documented non-keyword exception
parser sources: indexes needs exactly one editor class or a documented non-keyword exception
parser sources: jobs needs exactly one editor class or a documented non-keyword exception
parser sources: locked needs exactly one editor class or a documented non-keyword exception
parser sources: maintains needs exactly one editor class or a documented non-keyword exception
parser sources: outing needs exactly one editor class or a documented non-keyword exception
parser sources: production needs exactly one editor class or a documented non-keyword exception
parser sources: programs needs exactly one editor class or a documented non-keyword exception
parser sources: reads needs exactly one editor class or a documented non-keyword exception
parser sources: recipes needs exactly one editor class or a documented non-keyword exception
parser sources: removal needs exactly one editor class or a documented non-keyword exception
parser sources: retained needs exactly one editor class or a documented non-keyword exception
parser sources: routes needs exactly one editor class or a documented non-keyword exception
parser sources: rules needs exactly one editor class or a documented non-keyword exception
parser sources: shapes needs exactly one editor class or a documented non-keyword exception
parser sources: sharing needs exactly one editor class or a documented non-keyword exception
parser sources: synced needs exactly one editor class or a documented non-keyword exception
parser sources: totals needs exactly one editor class or a documented non-keyword exception
parser sources: transient needs exactly one editor class or a documented non-keyword exception
parser sources: types needs exactly one editor class or a documented non-keyword exception
parser sources: who needs exactly one editor class or a documented non-keyword exception
parser sources: writes needs exactly one editor class or a documented non-keyword exception
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    parser::reserved::editor_tests::every_parser_candidate_word_has_one_editor_class

test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 214 filtered out; finished in 0.02s

error: test failed, to rerun pass `-p snapback4-lang --lib`
```

Green tail:

`1-green.log`:

```text

warning: `snapback4-lang` (lib test) generated 8 warnings (run `cargo fix --lib -p snapback4-lang --tests` to apply 8 suggestions)
    Finished `test` profile [optimized + debuginfo] target(s) in 1m 31s
     Running unittests src/lib.rs (target/debug/deps/snapback4_lang-0b02be1b330fcbce)

running 4 tests
test parser::reserved::editor_tests::literal_census_sees_inline_array_membership ... ok
test parser::reserved::editor_tests::literal_census_keeps_all_word_shaped_literals ... ok
test parser::reserved::editor_tests::literal_census_sees_guard_strings ... ok
literal census: 14 parser sources, 261 candidate words, 183 editor spellings, 78 allowlist entries
test parser::reserved::editor_tests::every_parser_candidate_word_has_one_editor_class ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 214 filtered out; finished in 0.01s

```

### 2 — SHOULD: each template's actual vocabulary

**Verdict: fixed.** `expected-errors.txt` carries the committed per-template
vocabulary with comments pointing to each Rust expander. Timeline substitutes
only `@T@`; bridge substitutes its names array plus `@PREFIX@` and no dollar
locals. Receipts substitutes its exact 26 `.replace(...)` names and its ASCII
alphanumeric/underscore dollar-local expansion. Replacement lengths remain
unchanged, so original sites survive. Unsupported sigils remain in the source
and must produce located tree-sitter errors.

Tests: `template substitution rejects unsupported @X@ in timeline` and
`template substitution rejects unsupported $x in timeline` in `check.test.mjs`.
Both fault probes passed silently before the repair and now fail the fence at
the original template location. Existing unmatched-parenthesis and clean
three-template checks remain green.

Red tail:

`2-red.log`:

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2140.110917

✖ failing tests:

test at editors/tree-sitter-quarry/check.test.mjs:32:42
✖ template substitution rejects unsupported @X@ in timeline (1254.44775ms)
  AssertionError [ERR_ASSERTION]: fence silently accepted @X@: 
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:34:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at editors/tree-sitter-quarry/check.test.mjs:32:42
✖ template substitution rejects unsupported $x in timeline (823.386834ms)
  AssertionError [ERR_ASSERTION]: fence silently accepted $x: 
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:34:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

Green tail:

`2-green.log`:

```text

tree-sitter: 3 .q files, 0 quarry fences, 3 verified expected-error files; 1014 ms
✔ template substitution rejects unsupported @X@ in timeline (858.597083ms)
✔ template substitution rejects unsupported $x in timeline (1031.10725ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1963.023167
```

### 3 — SHOULD: off-stack recovery across ignored extras

**Verdict: reproduced and fixed.** The new comment, blank and mixed-extra
regressions each found an invented third block (expected two including the
following declaration). The scanner retains completed layout in a serialized
flag until the destination significant line ends. Ignored extras no longer
clear it, and a fresh significant newline resets it before computing the next
layout. The flag shares the existing pending word: the header remains 20 bytes
and the 250-nested-block bound is unchanged.

Tests: `off-stack dedent survives comment extras and incremental edits`,
`... blank ...`, and `... mixed ...` in `test/layout.test.mjs`. Each runs LF,
lone CR and CRLF and compares an incremental edit with a fresh parse. Numbers
and the following declaration's block survive. All three variants fail before
the fix; all 25 layout/recovery tests pass afterward.

Red tail:

`3-red.log`:

```text
        (parenthesized [0, 7] - [0, 9])
        (operator [0, 9] - [0, 10]))
      (block [1, 0] - [2, 0]
        (statement [1, 4] - [2, 0]
          (expression [1, 4] - [1, 12]
            (keyword [1, 4] - [1, 10])
            (number [1, 11] - [1, 12])))))
    (comment [2, 0] - [2, 10])
    (comment [4, 2] - [4, 16])
    (block [5, 0] - [6, 0]
      (statement [5, 2] - [6, 0]
        (expression [5, 2] - [5, 10]
          (keyword [5, 2] - [5, 8])
          (number [5, 9] - [5, 10]))))
    (declaration [6, 0] - [8, 0]
      (declaration_keyword [6, 0] - [6, 5])
      name: (declaration_name [6, 6] - [6, 7]
        (identifier [6, 6] - [6, 7]))
      (expression [6, 7] - [6, 10]
        (parenthesized [6, 7] - [6, 9])
        (operator [6, 9] - [6, 10]))
      (block [7, 0] - [8, 0]
        (statement [7, 2] - [8, 0]
          (expression [7, 2] - [7, 10]
            (keyword [7, 2] - [7, 8])
            (number [7, 9] - [7, 10]))))))
  
  3 !== 2
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/test/layout.test.mjs:107:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 3,
    expected: 2,
    operator: 'strictEqual',
    diff: 'simple'
  }
error: script "test" exited with code 1
```

Green tail:

`3-green.log`:

```text
✔ CR grouping recovers leading tabs like LF (28.3325ms)
✔ CR grouping ignores Unicode blank and comment lines (29.278125ms)
✔ logical CR line starts survive incremental serialization (17.978792ms)
✔ hyphenated keywords require the complete lexer boundary (64.834834ms)
✔ leading tabs recover indent and preserve the following declaration (18.189625ms)
✔ off-stack dedent pops to the enclosing level without inventing a new block (10.114291ms)
✔ off-stack dedent survives comment extras and incremental edits (83.425709ms)
✔ off-stack dedent survives blank extras and incremental edits (87.112125ms)
✔ off-stack dedent survives mixed extras and incremental edits (83.032292ms)
✔ unclosed group recovers locally and flushes the enclosing block at EOF (9.658416ms)
✔ unclosed brackets and braces retain local recovery through an edit (110.799166ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1397.758583
```

### 4 — SHOULD: self-tests inherit `--binary`

**Verdict: fixed.** The fence passes its selected absolute executable as
`QUARRY_EDITOR_BINARY` through its self-test runner. Both the first-line test
and syntax-exception probe consume it. The regression creates a small temporary
editor fixture without `target/debug/snapback4`, supplies a forwarding executable,
and asserts that both `grammar` and `check` reach it. The runner clears Node's
inherited test-worker context so nested regression runs execute real tests.
The regression lives in the tree-sitter test file, keeping the TextMate-only
bisection mode free of a new tree-sitter dependency. Its child uses Node's name
filter only to prevent recursive execution of this regression; the default
fence runs all its self-tests.

Test: `fence self-tests use the alternate binary with no default debug binary`
in `check.test.mjs`. The final control removes only the forwarding environment
variable and fails because both consumers attempt the missing debug binary.

Red tail:

`4-final-control-red.log`:

```text
        at Test.runInAsyncScope (node:async_hooks:227:14)
        at Test.run (node:internal/test_runner/test:1382:25)
        at Test.start (node:internal/test_runner/test:1242:17)
        at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)
  
  test at ../../../../../private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-binary-probe-SZZjy4/fixture/editors/vscode/test/first-line.test.mjs:5:1
  ✖ firstLine recognizes every exported declaration and comment with a word boundary (1.182208ms)
    Error: editor grammar: binary absent: /private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-binary-probe-SZZjy4/fixture/target/debug/snapback4; run cargo build -p snapback4 in snapback4/ or pass --binary <path>
        at lexicalFacts (file:///private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-binary-probe-SZZjy4/fixture/scripts/generate-editor-grammar.mjs:23:34)
        at TestContext.<anonymous> (file:///private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-binary-probe-SZZjy4/fixture/editors/vscode/test/first-line.test.mjs:6:21)
        at Test.runInAsyncScope (node:async_hooks:227:14)
        at Test.run (node:internal/test_runner/test:1382:25)
        at Test.start (node:internal/test_runner/test:1242:17)
        at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)
  
  
  1 !== 0
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:75:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Green tail:

`4-green.log`:

```text
✔ fence self-tests use the alternate binary with no default debug binary (2337.077209ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2423.1725
```

### 5 — MUST: non-failing refutations must not become invariant errors

**Verdict: fixed.** `E_SECURITY_INVARIANT` now requires a refuted verdict with
`authored-fixture-trace` or `generated-fixture-trace` reachability, matching
`Report::refuted`. Synthetic, trusted-seed and absent-counterexample observations
produce no invariant diagnostic. No new advisory code or matcher severity is
introduced.

`security-synthetic.json` is unedited stdout from the real 0.4.50 binary on the
schema in `synthetic_refutation_is_visible_but_does_not_fail_acceptance`, retained
as `security-synthetic.q`: `check --json` exits 0 with `ok: true`, and the refuted
invariant at `schema.q:8:1` has `synthetic-operation` reachability. The fixture
README gives the exact reproduction; `security-capture.log` retains status and
stdout. No fixture data or acknowledgment was needed. Constructed variants are
explicitly separate from that real capture.

Tests: `captured synthetic refutation is accepted without an invariant error`
and `only authored and generated fixture refutations become invariant errors`
in `check-problems.test.mjs`. The latter covers both failing reachabilities,
both non-failing reachabilities, and no counterexample. Existing real reachable
refusal fixtures still produce invariant errors.

Red tail:

`5-red.log`:

```text
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at editors/vscode/test/check-problems.test.mjs:32:1
✖ only authored and generated fixture refutations become invariant errors (442.233458ms)
  AssertionError [ERR_ASSERTION]: synthetic-operation: /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-diagnostics-uNGHRZ/snapback/schema.q:1:1: N_NO_PRODUCTION_WRITER notes: no production writer can bootstrap this root; fixtures and /seed are dev-only | missing mutation path: no mutation inserts notes; add a bootstrapnotes mutation that requires `viewer = 'service:ops'`, allow that branch in notes's insert rule, and make its required probes readable to the seat. Mint `snapback4 token --service ops --release ./deployment`, then call the mutation with the real account principal and its bearer token. For synced rosters use the independent seat-or-member branch; snapback4 guide deploy --section first admin Review this proposal, add the explicit service:ops insert branch to the table, and run check. No role is granted by signup. ```quarry mutation bootstrapnotes(body: text <=80, owner: principal): require viewer = 'service:ops' else NOT_OPERATOR return insert notes { body, owner } ```
  /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-diagnostics-uNGHRZ/snapback/schema.q:4:3: N_BROAD_READ notes.read: branch `allow` lets every signed-in user read every row | restrict this branch to the intended role and row relationship, or confirm that every row is public to signed-in users
  /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-diagnostics-uNGHRZ/snapback/schema.q:8:1: E_SECURITY_INVARIANT notes read (.owner = viewer): refuted via $security.notes.read as dev:security-b (synthetic-operation); read admission does not imply intent over independent predicates; a concrete replay is required for refutation; insert/unique/upsert collision outcomes can reveal an existing hidden row; old-row read authorization is not proved by new-image insert authority; wire sequencing/activity metadata has no logical-existence reduction; direct row-rule proof does not establish whole-protocol noninterference; server point/scan/planned view/count/sum/exists payload: observer authority does not imply the source policy; retain the privacy fields as bare group keys and apply the source privacy policy to this observer; concrete policy-false snapshot admitted by the actual engine; fixture origin is explicit, not an empty-state reachability theorem | repair enforcement or independently verify the specification intent; run snapback4 test and snapback4 audit
  
  true !== false
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/vscode/test/check-problems.test.mjs:41:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: true,
    expected: false,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Green tail:

`5-green.log`:

```text
✔ captured synthetic refutation is accepted without an invariant error (146.995542ms)
✔ only authored and generated fixture refutations become invariant errors (680.93575ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 914.775708
```

### 6 — SHOULD: acknowledged security notes disappear

**Verdict: fixed.** Security notes are filtered by their same-index review's
`acknowledged` flag before projection. No review array means all notes remain,
including the early `E_SECURITY_NOTES` envelope. A mixed two-note case proves
that acknowledgment hides only the corresponding entry.

Test: `acknowledged security notes are hidden by disposition index; absent
reviews retain notes` in `check-problems.test.mjs`: an `ok: true` envelope with
one `N_BROAD_READ` and a gated, acknowledged review prints no line; removing
the review array restores it. The captured early-error replay still passes.

Red tail:

`6-red.log`:

```text
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 227.959375

✖ failing tests:

test at editors/vscode/test/check-problems.test.mjs:44:1
✖ acknowledged security notes are hidden by disposition index; absent reviews retain notes (141.72125ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + [
  +   '/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-diagnostics-KC34gV/snapback/schema.q:3:3: N_BROAD_READ broad read | review intent'
  + ]
  - []
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/vscode/test/check-problems.test.mjs:48:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ '/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-diagnostics-KC34gV/snapback/schema.q:3:3: N_BROAD_READ broad read | review intent' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

Green tail:

`6-green.log`:

```text
✔ acknowledged security notes are hidden by disposition index; absent reviews retain notes (371.375917ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 459.542208
```

## Verification

All required commands ran from `snapback4/`, except `bun run test` whose cwd
is `editors/tree-sitter-quarry/` (selected through Bun's `--cwd`). The full fence
passes **1,138 .q files, 215 guide fences, three declared templates, 12 tree-sitter
corpus cases, 25 layout/recovery tests, and 19 editor/fence self-tests**.
The added real security source accounts for the one-file corpus increase.
The language library passes **217 tests, one ignored**, with no failures.
All **43 affected-selection tests** and verb-help checks pass. The fence's
21,287 ms is a single observed run under compilation load, not a latency claim.

### `node scripts/check-editor-grammar.mjs`

`fence-final.log`:

```text
✔ template substitution rejects unsupported @X@ in timeline (1255.749416ms)
✔ template substitution rejects unsupported $x in timeline (1376.917042ms)
✔ syntax exception checks the fixture in a real scratch project (1464.051916ms)
✔ local unclosed-group recovery remains a located fence failure (2072.50625ms)
✔ fence self-tests use the alternate binary with no default debug binary (1960.411167ms)
✔ captured synthetic refutation is accepted without an invariant error (361.049416ms)
✔ only authored and generated fixture refutations become invariant errors (1531.677083ms)
✔ acknowledged security notes are hidden by disposition index; absent reviews retain notes (614.293333ms)
✔ security-loosened: captured security refutation reaches Problems (227.10325ms)
✔ security-notes-error: captured security refutation reaches Problems (164.779583ms)
✔ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (608.718625ms)
✔ on-save surfaces missing node task failure (6.424833ms)
✔ on-save surfaces missing snapback4 task failure (2.824916ms)
✔ on-save surfaces compiler refusal task failure (0.81075ms)
✔ successful and unrelated tasks stay quiet; queued saves still run (0.94875ms)
✔ firstLine recognizes every exported declaration and comment with a word boundary (80.424042ms)
✔ corpus walk includes .snapback and excludes only target and node_modules (4.451292ms)
✔ corpus walk refuses symlink files, directories, cycles and dangling links loudly (4.412375ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9833.714291
editor grammar: 1138 .q files, 215 quarry fences, 0 failures; 21287 ms (TextMate + tree-sitter)
```

### `RUST_MIN_STACK=33554432 cargo test -p snapback4-lang --lib`

`lang-lib.log`:

```text
test repair::safe::tests::present_literal_unique_population_has_a_safe_bound_rewrite ... ok
test repair::safe::tests::nullable_unique_population_is_never_repaired_with_first_one ... ok
test repair::tests::count_star_prose_is_not_a_verified_replacement ... ok
test repair::tests::fallback_probe_cannot_collide_with_authored_operations_or_modules ... ok
test repair::tests::broken_syntax_names_and_types_are_suppressed_before_offering ... ok
test repair::tests::compiling_repairs_that_change_point_or_page_class_are_suppressed ... ok
test repair::tests::key_page_fallback_preserves_total_and_nullable_populations ... ok
test source::tests::canonical_backend_sites_do_not_replace_authored_diagnostic_spelling ... ok
test source::tests::explicit_index_search_sites_retain_authored_spelling ... ok
test repair::tests::uncalled_helpers_still_need_a_checked_probe ... ok
test bind::security::derived::transition_questions::tests::source_edges_do_not_depend_on_names_or_enum_order ... ok
test bind::security::derived::transition_questions::tests::helper_reduction_cannot_erase_an_anchor_field_prerequisite ... ok
test bind::security::challenges::generated::sec9_clock_reach_tests::future_payment_can_be_replayed_against_clock_intent ... ok
test bind::security::derived::workflow::tests::spread_parent_reopening_cannot_establish_terminal_completion ... ok
test bind::security::derived::transition_questions::tests::noops_reverted_deleted_and_expired_updates_do_not_supply_cards ... ok
test bind::security::derived::assignment_questions::tests::an_unmodeled_lead_assignment_has_an_actual_private_column_read ... ok
test bind::security::challenges::generated::sec10_clock_reach_tests::an_old_caller_date_reaches_the_named_order_transition ... ok
test bind::security::derived::transition_questions::tests::guard_presence_cannot_hide_an_admitted_jump_and_secondary_types_bind_the_basis ... ok
test bind::security::derived::assignment_questions::tests::another_coordinator_actually_reads_the_assigned_private_payload ... ok
test bind::security::derived::approval_questions::tests::approval_questions_have_actual_targeted_replays ... ok
test bind::security::derived::transition_questions::tests::actual_committed_edges_and_minimal_repairs ... ok

test result: ok. 217 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 32.03s

```

### `bun run test` (cwd `editors/tree-sitter-quarry`)

`3-green.log`:

```text
✔ lone CR normalization (9.587458ms)
✔ deeper shape, and-space and or-space continue across blank/comments (29.168917ms)
✔ same-depth and/or, prefixes and tab separators do not continue (56.127291ms)
✔ Unicode whitespace is not indentation produces a parse error (9.498583ms)
✔ unclosed string produces a parse error (9.692166ms)
✔ unknown punctuation at multiple sites produces a parse error (8.795416ms)
✔ scanner serialization survives incremental changes to layout and grouping (55.676417ms)
✔ CR grouping recovers leading tabs like LF (28.3325ms)
✔ CR grouping ignores Unicode blank and comment lines (29.278125ms)
✔ logical CR line starts survive incremental serialization (17.978792ms)
✔ hyphenated keywords require the complete lexer boundary (64.834834ms)
✔ leading tabs recover indent and preserve the following declaration (18.189625ms)
✔ off-stack dedent pops to the enclosing level without inventing a new block (10.114291ms)
✔ off-stack dedent survives comment extras and incremental edits (83.425709ms)
✔ off-stack dedent survives blank extras and incremental edits (87.112125ms)
✔ off-stack dedent survives mixed extras and incremental edits (83.032292ms)
✔ unclosed group recovers locally and flushes the enclosing block at EOF (9.658416ms)
✔ unclosed brackets and braces retain local recovery through an edit (110.799166ms)
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1397.758583
```

### `node --test editors/vscode/test/*.test.mjs editors/tree-sitter-quarry/check.test.mjs scripts/check-editor-grammar.test.mjs`

`editor-tests-final.log`:

```text
✔ template substitution still rejects an unrelated unmatched parenthesis (1717.115208ms)
✔ template substitution rejects unsupported @X@ in timeline (1210.016667ms)
✔ template substitution rejects unsupported $x in timeline (1703.780416ms)
✔ syntax exception checks the fixture in a real scratch project (1375.268083ms)
✔ local unclosed-group recovery remains a located fence failure (1267.047792ms)
✔ fence self-tests use the alternate binary with no default debug binary (1517.939666ms)
✔ captured synthetic refutation is accepted without an invariant error (307.190375ms)
✔ only authored and generated fixture refutations become invariant errors (1331.715916ms)
✔ acknowledged security notes are hidden by disposition index; absent reviews retain notes (249.75ms)
✔ security-loosened: captured security refutation reaches Problems (217.294458ms)
✔ security-notes-error: captured security refutation reaches Problems (100.47575ms)
✔ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (423.180458ms)
✔ on-save surfaces missing node task failure (4.492791ms)
✔ on-save surfaces missing snapback4 task failure (1.52525ms)
✔ on-save surfaces compiler refusal task failure (0.654666ms)
✔ successful and unrelated tasks stay quiet; queued saves still run (0.685083ms)
✔ firstLine recognizes every exported declaration and comment with a word boundary (39.775291ms)
✔ corpus walk includes .snapback and excludes only target and node_modules (3.043583ms)
✔ corpus walk refuses symlink files, directories, cycles and dangling links loudly (7.038167ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9017.283875
```

### `node --test scripts/affected.test.mjs`

`affected.log`:

```text
✔ documentation-shaped shared input snapback4/crates/snapback4-lang/tests/fixtures/input.md still fails broad (0.1005ms)
✔ documentation-shaped shared input snapback4/scripts/helpers/input.md still fails broad (0.083833ms)
✔ documentation-shaped shared input snapback4/unknown/input.md still fails broad (0.081833ms)
✔ computed and unresolved imports conservatively require a client dist rebuild (0.228125ms)
✔ CI attempts independent setup and retains failure after verification (0.802875ms)
✔ Rust guide implementation snapback4/crates/snapback4-lang/src/guide.rs retains reverse dependencies (0.304417ms)
✔ Rust guide implementation snapback4/crates/snapback4-lang/src/guide/codes.rs retains reverse dependencies (0.36825ms)
✔ embedded init template day2-proof.mjs selects its binary source and consumers (0.3595ms)
✔ embedded init template previous/day2-proof-0.4.40.mjs selects its binary source and consumers (0.262541ms)
✔ guide integration modules and named fixtures select their compiled consumer (2.215542ms)
✔ filesystem issue records require reference validation without widening product scope (0.319125ms)
✔ editor grammar inputs select the fence with a freshly built CLI (0.829ms)
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34886.681
```

### `node scripts/check-verb-help.mjs`

`verb-help.log`:

```text
changelog verb help: all announced flags present
```

### Parser production invariance and allowlist counts

`parser-invariance.log`:

```text
All 14 parser production prefixes byte-identical to f5abc83967; no Rust acceptance change.
Allowlist before: 48
Allowlist after: 78
```

### `./ref-check --verbose` (repository root)

Exit 0. `git diff --check` also passes.

`ref-check.log`:

```text
ref-check: ok — 581 LLP docs, 12326 refs in 47592 files, 0 errors, 0 unchecked
```

## Development corrections and handoff

The first expanded-census run was accidentally launched from the repository
root with `--manifest-path snapback4/Cargo.toml`, which missed Snapback 4's
local Cargo profile defaults and caused a longer rebuild. Its actual result
is retained as `1-census-initial.log`; the final focused and full library runs
were launched from `snapback4/`. An early alternate-binary harness inherited
Node's test-worker context; clearing that context made the nested test execution
explicit. The final control and green evidence use the corrected harness.

The journal receives the append-only EDITOR4 entry, RFC §10 records the census
redesign and all corrections, and the relevant editor READMEs and capture
provenance are reconciled. Generated grammar bytes remain unchanged and the
fence verifies them. No Rust parser production text, class spelling, reservation
set, compiler diagnostic or acceptance rule changes. No VSIX repackaging,
publication, editor installation or GUI observation is claimed.

## Deferred

No requested lane item is deferred. General severity mapping for existing
`N_` compiler notes remains outside this final fix round: the existing matcher
uses error severity for all matched lines, as the extension README documents.
Item 5 suppresses non-failing invariant observations entirely, so it introduces
no advisory code needing a severity. If desired, the orchestrator can file the
broader note-severity UX change separately; it is not required to resolve either
security finding here. No additional fix round is proposed.
