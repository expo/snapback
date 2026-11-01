# LLP 3000.041 — review fixes, round 1

2026-10-30. Lane branch started at `27228a8789` (chunk B), with chunk A
`2d45b71e0e` beneath it. **No commit or staging operation was performed.**
All eleven distinct findings were reproduced and fixed. No finding was refuted
or deferred; the three overlapping Grok findings are paired below.

## Scope and constraints

The read-only `llp-orient` pass covered the Snapback 4 fence, LLP 3000,
LLP 2000.000, LLP 3000.041 §§2.1–2.4 and 8, the language/security guide cards,
local AGENTS/NOT-DOING/RULES, both review files and the prior reports. The
Rust parser remains authoritative; no accepted program, reservation list or
runtime compiler diagnostic was changed. The only Rust edit is inside the
`#[cfg(test)]` editor-comparison module. The work uses this checkout, the
existing Node 24.19.0 runtime, Bun 1.4.2 and pinned editor devDependencies.
No global package installation, other machine, clone or delegated agent was used.

For Node commands, PATH began with
`/Users/ccheever/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
`bun run test` used `XDG_CACHE_HOME=/tmp/quarry-r1-tree-sitter-cache` because
its default cache is outside the writable sandbox. The fence already uses
its own temporary cache. The first direct run's cache refusal was environmental,
not a product test result.

## Per-finding evidence

Raw outputs are retained in [r1-logs](./r1-logs/). Below, the red tails are from
the test added before the repair (item 1 was replayed again against HEAD's
wrapper using the final captured envelopes); green tails are from the repaired
implementation. Some tails include Node assertion-stack detail. The full final
runs below supersede intermediate counts.

### 1 — security diagnostics

Fixed. `check-problems.mjs` projects `security.notes`, refuted `security.invariants` and gated, unacknowledged `securityReviews`. The wrapper-only code `E_SECURITY_INVARIANT` labels invariant verdicts; messages retain counterexample reachability and reasons. Sites come from the compiler, never an invented line. Non-located findings stay on stderr.

Test: `editors/vscode/test/check-problems.test.mjs`: both `captured security refutation reaches Problems` tests and `pending security reviews keep their site and review instruction; acknowledged reviews are not pending`.

Red tail — `1-red.log`:

```text
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

test at editors/vscode/test/check-problems.test.mjs:36:1
✖ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (132.626041ms)
  AssertionError [ERR_ASSERTION]: {"status":1,"stdout":[],"stderr":["quarry check: compiler refused without a located diagnostic; run snapback4 check --review for details"]}
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/vscode/test/check-problems.test.mjs:40:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

Green tail — `1-green.log`:

```text
✔ security-loosened: captured security refutation reaches Problems (107.07ms)
✔ security-notes-error: captured security refutation reaches Problems (107.49625ms)
✔ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (387.720917ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 720.87475
```

### 2 / Grok 3 — comparison census

Fixed. The test-only Rust scanner sees literal slices used by `.contains`, literal-left equality and `matches!` literal patterns. Production sources are joined after their test sections are removed, so a constant in `parser.rs` and its uses in `programs.rs` are visible together. All thirteen `TEXT_PATTERN_WORDS` are accounted for by reusing that existing constant in the allowlist with the reason **refusal-only**. They remain ordinary identifiers in editors because they are unsupported operators, not accepted syntax. No reservation or parsing code changed. Both grammars were regenerated; their word tables are byte-identical because this classification does not add accepted words.

Test: `parser::reserved::editor_tests::{compared_words_sees_literal_slice_membership, compared_words_sees_literal_left_equality, compared_words_sees_matches_literal_patterns}`; `every_parser_word_comparison_has_one_editor_class` also passes and checks the real thirteen spellings.

Red tail — `2-red.log`:

```text

---- parser::reserved::editor_tests::compared_words_sees_literal_left_equality stdout ----

thread 'parser::reserved::editor_tests::compared_words_sees_literal_left_equality' (362578410) panicked at crates/snapback4-lang/src/parser/reserved.rs:230:9:
assertion failed: compared_words(r#"if "unclassified" == token.value {}"#).contains("unclassified")
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

---- parser::reserved::editor_tests::compared_words_sees_matches_literal_patterns stdout ----

thread 'parser::reserved::editor_tests::compared_words_sees_matches_literal_patterns' (362578412) panicked at crates/snapback4-lang/src/parser/reserved.rs:234:9:
assertion failed: compared_words(r#"matches!(token.value.as_str(), "unclassified")"#).contains("unclassified")

---- parser::reserved::editor_tests::compared_words_sees_literal_slice_membership stdout ----

thread 'parser::reserved::editor_tests::compared_words_sees_literal_slice_membership' (362578411) panicked at crates/snapback4-lang/src/parser/reserved.rs:225:9:
assertion `left == right` failed
  left: {}
 right: {"secondword", "unclassified"}


failures:
    parser::reserved::editor_tests::compared_words_sees_literal_left_equality
    parser::reserved::editor_tests::compared_words_sees_literal_slice_membership
    parser::reserved::editor_tests::compared_words_sees_matches_literal_patterns

test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 215 filtered out; finished in 0.01s

error: test failed, to rerun pass `-p snapback4-lang --lib`
```

Green tail — `2-green.log`:

```text
   |                           ^^^^^^^^

warning: `snapback4-lang` (lib test) generated 8 warnings (run `cargo fix --lib -p snapback4-lang --tests` to apply 8 suggestions)
    Finished `test` profile [optimized + debuginfo] target(s) in 1m 21s
     Running unittests src/lib.rs (target/debug/deps/snapback4_lang-7b6c57d592eb853c)

running 4 tests
test parser::reserved::editor_tests::compared_words_sees_literal_left_equality ... ok
test parser::reserved::editor_tests::compared_words_sees_literal_slice_membership ... ok
test parser::reserved::editor_tests::compared_words_sees_matches_literal_patterns ... ok
test parser::reserved::editor_tests::every_parser_word_comparison_has_one_editor_class ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 214 filtered out; finished in 0.01s

```

### 3 — CR logical line starts

Fixed after reproduction. The old scanner accepted a leading tab inside CR-separated grouping and rejected Unicode whitespace before a CR-separated comment. Logical line-start columns now survive scanner serialization. The intermediate tests below prove this repair before G2; G2 subsequently changes the tab expectation to recovered highlighting for CR, CRLF and LF alike, leaving the compiler diagnosis authoritative.

Test: `CR grouping ignores Unicode blank and comment lines`, `logical CR line starts survive incremental serialization`, and final `CR grouping recovers leading tabs like LF` in `test/layout.test.mjs`.

Red tail — `3-red.log`:

```text
            (call [0, 13] - [0, 42]
              function: (keyword [0, 13] - [0, 19])
              (parenthesized [0, 20] - [0, 42]
                (ERROR [0, 22] - [0, 38]
                  (ERROR [0, 22] - [0, 24])
                  (comment [0, 24] - [0, 34])
                  (ERROR [0, 34] - [0, 38]))
                (expression [0, 38] - [0, 41]
                  (number [0, 38] - [0, 41])))))))))
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/test/layout.test.mjs:82:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
error: script "test" exited with code 1
```

Green tail — `3-green.log`:

```text
✔ unclosed string produces a parse error (12.261958ms)
✔ unknown punctuation at multiple sites produces a parse error (12.921458ms)
✔ scanner serialization survives incremental changes to layout and grouping (120.398083ms)
✔ CR grouping still diagnoses leading tabs (74.902042ms)
✔ CR grouping ignores Unicode blank and comment lines (44.724584ms)
✔ logical CR line starts survive incremental serialization (28.669708ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2102.134875
```

### 4 / Grok 6 — template exceptions

Fixed after reproduction. The old fence silently accepted an unmatched `)` appended to the timeline template. The three declared templates are now copied into temporary inputs, replacing only `@NAME@` and `$name` with equal-byte-length identifiers. Every resulting error is reported using the original source path and position. A missing placeholder makes the exception stale. The pinned CLI emits captures without numeric prefixes on these probes; the reader accepts both documented output forms instead of losing the site.

Test: `editors/tree-sitter-quarry/check.test.mjs`: `template substitution still rejects an unrelated unmatched parenthesis`.

Red tail — `4-red.log`:

```text
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1869.365542

✖ failing tests:

test at editors/tree-sitter-quarry/check.test.mjs:27:1
✖ template substitution still rejects an unrelated unmatched parenthesis (1734.2765ms)
  AssertionError [ERR_ASSERTION]: fence silently accepted template fault: 
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:29:3)
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
```

Green tail — `45-green.log`:

```text

Total parses: 12; successful parses: 12; failed parses: 0; success percentage: 100.00%; average speed: 3181 bytes/ms

tree-sitter: 4 .q files, 0 quarry fences, 4 verified expected-error files; 933 ms
✔ template substitution still rejects an unrelated unmatched parenthesis (962.149334ms)
✔ syntax exception checks the fixture in a real scratch project (958.691083ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2006.533042
```

### 5 — syntax-fixture cwd

Fixed after reproduction. The added temporary syntax exception previously failed with “no snapback/schema.q here or above”. It is now copied into a temporary project at `snapback/schema.q`; the real compiler runs `check --json` with that project as cwd, and its E_QUARRY_SYNTAX is verified. The fixture, project and extra exception are removed by test cleanup. The committed list still contains exactly the three templates.

Test: `editors/tree-sitter-quarry/check.test.mjs`: `syntax exception checks the fixture in a real scratch project`.

Red tail — `5-red.log`:

```text
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1648.892875

✖ failing tests:

test at editors/tree-sitter-quarry/check.test.mjs:31:1
✖ syntax exception checks the fixture in a real scratch project (1564.1415ms)
  Error: tree-sitter: /Users/ccheever/projects/snapback-quarry-grammar/snapback4/target/debug/snapback4 check --json /var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-fence-probe-mbwp2Q/project/crates/snapback4-lang/tests/fixtures/editor-syntax-probe.q failed (2)
  no snapback/schema.q here or above; run `snapback4 init` to start one
  
  
      at run (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.mjs:30:60)
      at checkTreeSitter (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.mjs:73:23)
      at probe (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:23:5)
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/check.test.mjs:32:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)
```

Green tail — `45-green.log`:

```text

Total parses: 12; successful parses: 12; failed parses: 0; success percentage: 100.00%; average speed: 3181 bytes/ms

tree-sitter: 4 .q files, 0 quarry fences, 4 verified expected-error files; 933 ms
✔ template substitution still rejects an unrelated unmatched parenthesis (962.149334ms)
✔ syntax exception checks the fixture in a real scratch project (958.691083ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2006.533042
```

### 6 — ignored Unicode whitespace

Fixed after reproduction. TextMate now scopes Rust Unicode White_Space on blank/comment-only lines. No Unicode whitespace was added between ordinary tokens or before significant code. Corpus-free witnesses exercise eleven representative Unicode/control whitespace characters in ignored and significant positions.

Test: `scripts/check-editor-grammar.mjs` self-tests: `ignored Unicode whitespace scope witness` and `significant Unicode whitespace must fall through`.

Red tail — `6-red.log`:

```text
AssertionError [ERR_ASSERTION]: ignored Unicode whitespace scope witness: "\u000b"
    at main (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/scripts/check-editor-grammar.mjs:116:9)
```

Green tail — `6-green.log`:

```text
TextMate ignored-line Unicode whitespace witnesses: pass
editor grammar: 1137 .q files, 215 quarry fences, 0 failures; 5528 ms (TextMate only; tree-sitter NOT checked)
```

### 7 / Grok 4 — generated firstLine

Fixed after reproduction (`action` was the first missing declaration). The generator derives the manifest expression from `comment` and all nineteen `declaration_words`; the fence compares its temporary regenerated manifest. A separate stale-manifest fault also produced the required freshness failure, after which the manifest was restored.

Test: `editors/vscode/test/first-line.test.mjs`: `firstLine recognizes every exported declaration and comment with a word boundary`.

Red tail — `7-red.log`:

```text
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 104.220666

✖ failing tests:

test at editors/vscode/test/first-line.test.mjs:5:1
✖ firstLine recognizes every exported declaration and comment with a word boundary (25.94475ms)
  AssertionError [ERR_ASSERTION]: firstLine misses action
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/vscode/test/first-line.test.mjs:10:5)
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
```

Green tail — `7-green.log`:

```text
✔ firstLine recognizes every exported declaration and comment with a word boundary (23.970625ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 95.657084
```

Freshness fault tail (manifest restored afterward):

`7-freshness-red.log`:

```text
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
editor grammar: 1137 .q files, 215 quarry fences, 2 failures; 6353 ms (TextMate only; tree-sitter NOT checked)
editor grammar: committed firstLine differs: run node scripts/generate-editor-grammar.mjs
editor grammar: editor self-tests failed: 1

```

### G1 — hyphenated token boundary

Fixed after reproduction. The old tree had a keyword span over `until-revoked` in `return until-revoked-extra`. The external scanner now enforces the complete ASCII word/hyphen boundary, falling back to ordinary identifiers and minus tokens on failure. Its two spellings come from the generated `src/keywords.generated.h`, with independent freshness checking; no hand-maintained keyword list was introduced.

Test: `test/layout.test.mjs`: `hyphenated keywords require the complete lexer boundary` (suffix letters, digits, underscore and hyphen; both exact keywords).

Red tail — `G1-red.log`:

```text
✖ failing tests:

test at test/layout.test.mjs:85:1
✖ hyphenated keywords require the complete lexer boundary (696.623375ms)
  AssertionError [ERR_ASSERTION]: until-revoked-extra
  (source_file [0, 0] - [1, 0]
    (statement [0, 0] - [1, 0]
      (expression [0, 0] - [0, 26]
        (keyword [0, 0] - [0, 6])
        (keyword [0, 7] - [0, 20])
        (operator [0, 20] - [0, 21])
        (identifier [0, 21] - [0, 26]))))
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/test/layout.test.mjs:88:5)
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
```

Green tail — `G1-green.log`:

```text
✔ unknown punctuation at multiple sites produces a parse error (12.103208ms)
✔ scanner serialization survives incremental changes to layout and grouping (73.858042ms)
✔ CR grouping still diagnoses leading tabs (14.911083ms)
✔ CR grouping ignores Unicode blank and comment lines (37.0875ms)
✔ logical CR line starts survive incremental serialization (36.455459ms)
✔ hyphenated keywords require the complete lexer boundary (79.645375ms)
ℹ tests 23
ℹ suites 0
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1389.315791
```

### G2 — layout recovery

Fixed after reproduction. Leading tabs count as one indentation column, off-stack dedents pop to the nearest lower enclosing level without adding an indent, and unclosed groups preserve their block and token structure with a local `missing_delimiter`. Native tree-sitter considers the explicit recovery node successful, so the fence queries it alongside ERROR/MISSING over the entire census, and highlight queries capture it as an error. Tests require the fence to report its original file and location. The initial-negative-value witness was strengthened and exposed a remaining indent omission; the final scanner distinguishes a leading minus from a comment and emits that indent too.

Test: `test/layout.test.mjs`: `leading tabs recover indent and preserve the following declaration`, `off-stack dedent pops to the enclosing level without inventing a new block`, `unclosed group recovers locally and flushes the enclosing block at EOF`, `unclosed brackets and braces retain local recovery through an edit`; `check.test.mjs`: `local unclosed-group recovery remains a located fence failure`.

Red tail — `G2-red.log`:

```text
        (parenthesized [0, 7] - [0, 9])
        (operator [0, 9] - [0, 10])))
    (ERROR [1, 0] - [2, 7]
      (keyword [1, 2] - [1, 8])
      (number [1, 10] - [1, 11])
      (operator [2, 4] - [2, 5])
      (number [2, 6] - [2, 7])))
  
  0 !== 1
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/test/layout.test.mjs:105:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Green tail — `tree-sitter-final.log`:

```text
✔ logical CR line starts survive incremental serialization (19.800709ms)
✔ hyphenated keywords require the complete lexer boundary (67.523542ms)
✔ leading tabs recover indent and preserve the following declaration (20.920667ms)
✔ off-stack dedent pops to the enclosing level without inventing a new block (9.908583ms)
✔ unclosed group recovers locally and flushes the enclosing block at EOF (9.875042ms)
✔ unclosed brackets and braces retain local recovery through an edit (123.015ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1582.457042
```

Additional initial-minus indent red tail:

`G2-negative-indent-red.log`:

```text
✖ failing tests:

test at editors/tree-sitter-quarry/test/layout.test.mjs:91:1
✖ leading tabs recover indent and preserve the following declaration (691.100334ms)
  AssertionError [ERR_ASSERTION]: a tab before an initial negative value still emits Indent
  
  0 !== 1
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/tree-sitter-quarry/test/layout.test.mjs:95:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.start (node:internal/test_runner/test:1242:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

### G5 — total corpus walk

Fixed after reproduction. `.snapback/` is included. Symlink entries fail loudly instead of disappearing; the brief explicitly permits refusal instead of following. Files, directories, cycles and dangling links are covered. Only `target` and `node_modules` are excluded.

Test: `scripts/check-editor-grammar.test.mjs`: `corpus walk includes .snapback and excludes only target and node_modules`; `corpus walk refuses symlink files, directories, cycles and dangling links loudly`.

Red tail — `G5-red.log`:

```text
    expected: [ '/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/quarry-walk-n5vyoE/.snapback/example.q' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at scripts/check-editor-grammar.test.mjs:15:1
✖ corpus walk refuses symlink files, directories, cycles and dangling links loudly (2.900834ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception: file
      at file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/scripts/check-editor-grammar.test.mjs:21:12
      at scratch (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/scripts/check-editor-grammar.test.mjs:9:9)
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/scripts/check-editor-grammar.test.mjs:16:66)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1382:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:960:18)
      at Test.postRun (node:internal/test_runner/test:1522:19)
      at Test.run (node:internal/test_runner/test:1447:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: /symlink.*linked.q/,
    operator: 'throws',
    diff: 'simple'
  }
```

Green tail — `G5-green.log`:

```text
✔ corpus walk includes .snapback and excludes only target and node_modules (4.552708ms)
✔ corpus walk refuses symlink files, directories, cycles and dangling links loudly (4.267167ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 93.650083
```

### G7 — failed on-save tasks

Fixed after reproduction with the VS Code API mock. `onDidEndTaskProcess` displays a message for nonzero or unknown Quarry task exits and directs the user to Problems and the task terminal. Successes and unrelated tasks remain quiet; queued saves still execute. This is API-level coverage, not a GUI observation.

Test: `editors/vscode/test/extension.test.mjs`: `on-save surfaces missing node task failure`, `on-save surfaces missing snapback4 task failure`, `on-save surfaces compiler refusal task failure`, and `successful and unrelated tasks stay quiet; queued saves still run`.

Red tail — `G7-red.log`:

```text
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at editors/vscode/test/extension.test.mjs:23:110
✖ on-save surfaces compiler refusal task failure (1.215959ms)
  AssertionError [ERR_ASSERTION]: task failure was silent
  
  0 !== 1
  
      at TestContext.<anonymous> (file:///Users/ccheever/projects/snapback-quarry-grammar/snapback4/editors/vscode/test/extension.test.mjs:28:10)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Green tail — `G7-green.log`:

```text
✔ on-save surfaces missing node task failure (2.35675ms)
✔ on-save surfaces missing snapback4 task failure (1.266083ms)
✔ on-save surfaces compiler refusal task failure (0.523583ms)
✔ successful and unrelated tasks stay quiet; queued saves still run (0.711083ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 74.283791
```

## Security fixture provenance

`editors/vscode/test/fixtures/security-loosened.json` and
`security-notes-error.json` are unedited stdout from the real built binary on a
scratch project, not hand-constructed reports. The source and exact reproduction
steps are beside them in `security-loosened.q` and `README.md`. They use the
existing `check_notes.rs` owner-only rule/invariant scenario: narrow rule exit 0,
loosened rule exit 1, then invalid security-disposition file exit 2. Both captures
carry a located refutation at `schema.q:7:1`. The synthetic pending-review test
is separate and labelled. Runtime durations and compiler evidence remain in the
captured envelopes. The scratch projects were removed.

## Corrected lexer/scanner mapping (supersedes REPORT-B for these cases)

| Rust lexer behavior | Final editor scanner behavior | Witness |
| --- | --- | --- |
| Normalize CRLF and lone CR to LF | Persist the logical line-start column through serialized state | CR + grouping + Unicode comments/blanks; incremental edit |
| Ignore Unicode-trimmed blank/comment lines before checking indentation | Skip those prefixes, including within CR-separated groups | Combined whitespace/layout tests |
| Diagnose leading tabs, count each as one indent column, still emit tokens | Emit the same layout and preserve following declarations; compiler owns the diagnosis | Leading tab, initial negative value, CR/LF grouping |
| Pop off-stack dedents before diagnosing | Pop to nearest lower enclosing level; do not invent a new block | Nested off-stack dedent and following declaration |
| Diagnose unclosed grouping but flush dedents and EOF | Insert a local missing_delimiter recovery node, retain tokens/block, then flush layout; highlight/fence treat it as an error | Paren/bracket/brace/nested EOF cases and repair edits; located fence fault probe |
| Hyphenated keywords require a full trailing boundary | External token checks the same ASCII word/hyphen boundary using generated spellings | Exact and suffixed hyphenated words |

The scanner header now occupies 20 bytes; the 1,024-byte serialization buffer
stores 251 indentation levels including root, hence **250 nested blocks**. This
one-level reduction is explicitly documented in the editor README; the existing
loud depth limit remains an editor constraint, not a Rust language change.

## Verification

All requested commands ran from `snapback4/` unless a different cwd is named.
No known base red occurred in the requested final suite. The full fence covers
**1,137 .q files** (the prior 1,136 plus the captured security source) and
**215 guide fences**, with exactly three template declarations. The default
fence now runs the thirteen wrapper/extension/manifest/walk/fault-probe self-tests
as well as the 12 tree-sitter corpus examples and 22 layout/recovery tests.
The single final fence timing is an observation, not a stable latency claim.

### `cargo build -p snapback4`

`build-final.log`:

```text
warning: function `exposure` is never used
  --> crates/snapback4/src/verbs/security.rs:96:15
   |
96 | pub(super) fn exposure(report:&Report){
   |               ^^^^^^^^

warning: `snapback4` (bin "snapback4") generated 30 warnings (run `cargo fix --bin "snapback4" -p snapback4` to apply 2 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 13.35s
```

### `RUST_MIN_STACK=33554432 cargo test -p snapback4-lang --lib`

`lang-lib.log`:

```text
test repair::tests::key_page_fallback_preserves_total_and_nullable_populations ... ok
test repair::tests::uncalled_helpers_still_need_a_checked_probe ... ok
test bind::security::derived::transition_questions::tests::helper_reduction_cannot_erase_an_anchor_field_prerequisite ... ok
test emit::rust::tests::colliding_and_reserved_quarry_names_emit_compilable_unique_rust ... ok
test source::tests::canonical_backend_sites_do_not_replace_authored_diagnostic_spelling ... ok
test source::tests::explicit_index_search_sites_retain_authored_spelling ... ok
test bind::security::release_create::calibrated_source_pairs::each_requested_day_two_create_hole_retains_a_release_candidate ... ok
test bind::security::derived::transition_questions::tests::source_edges_do_not_depend_on_names_or_enum_order ... ok
test bind::security::derived::declared_column_edit_intent_disposes_only_its_inferred_approval_freeze ... ok
test bind::security::derived::workflow::tests::spread_parent_reopening_cannot_establish_terminal_completion ... ok
test bind::security::derived::transition_questions::tests::noops_reverted_deleted_and_expired_updates_do_not_supply_cards ... ok
test bind::security::derived::assignment_questions::tests::an_unmodeled_lead_assignment_has_an_actual_private_column_read ... ok
test bind::security::challenges::generated::sec10_clock_reach_tests::an_old_caller_date_reaches_the_named_order_transition ... ok
test bind::security::derived::transition_questions::tests::guard_presence_cannot_hide_an_admitted_jump_and_secondary_types_bind_the_basis ... ok
test bind::security::derived::assignment_questions::tests::another_coordinator_actually_reads_the_assigned_private_payload ... ok
test bind::security::derived::approval_questions::tests::approval_questions_have_actual_targeted_replays ... ok
test bind::security::derived::transition_questions::tests::actual_committed_edges_and_minimal_repairs ... ok

test result: ok. 217 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 36.01s

```

### `node scripts/check-editor-grammar.mjs`

`fence-final.log`:

```text
✔ template substitution still rejects an unrelated unmatched parenthesis (1168.328ms)
✔ syntax exception checks the fixture in a real scratch project (1087.320625ms)
✔ local unclosed-group recovery remains a located fence failure (985.121333ms)
✔ security-loosened: captured security refutation reaches Problems (90.532875ms)
✔ security-notes-error: captured security refutation reaches Problems (88.209625ms)
✔ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (338.589ms)
✔ on-save surfaces missing node task failure (3.596083ms)
✔ on-save surfaces missing snapback4 task failure (1.896042ms)
✔ on-save surfaces compiler refusal task failure (1.038833ms)
✔ successful and unrelated tasks stay quiet; queued saves still run (2.996667ms)
✔ firstLine recognizes every exported declaration and comment with a word boundary (40.328042ms)
✔ corpus walk includes .snapback and excludes only target and node_modules (4.849334ms)
✔ corpus walk refuses symlink files, directories, cycles and dangling links loudly (4.420833ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3331.560917
editor grammar: 1137 .q files, 215 quarry fences, 0 failures; 13501 ms (TextMate + tree-sitter)
```

### `bun run test (cwd editors/tree-sitter-quarry)`

`tree-sitter-final.log`:

```text
✔ unknown punctuation at multiple sites produces a parse error (10.441042ms)
✔ scanner serialization survives incremental changes to layout and grouping (58.379792ms)
✔ CR grouping recovers leading tabs like LF (27.722875ms)
✔ CR grouping ignores Unicode blank and comment lines (28.029958ms)
✔ logical CR line starts survive incremental serialization (19.800709ms)
✔ hyphenated keywords require the complete lexer boundary (67.523542ms)
✔ leading tabs recover indent and preserve the following declaration (20.920667ms)
✔ off-stack dedent pops to the enclosing level without inventing a new block (9.908583ms)
✔ unclosed group recovers locally and flushes the enclosing block at EOF (9.875042ms)
✔ unclosed brackets and braces retain local recovery through an edit (123.015ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1582.457042
```

### `node --test editors/tree-sitter-quarry/check.test.mjs editors/vscode/test/*.test.mjs scripts/check-editor-grammar.test.mjs`

`editor-tests-final.log`:

```text
✔ security-loosened: captured security refutation reaches Problems (272.374917ms)
✔ security-notes-error: captured security refutation reaches Problems (183.273458ms)
✔ pending security reviews keep their site and review instruction; acknowledged reviews are not pending (827.079792ms)
✔ on-save surfaces missing node task failure (3.504041ms)
✔ on-save surfaces missing snapback4 task failure (2.061ms)
✔ on-save surfaces compiler refusal task failure (1.088083ms)
✔ successful and unrelated tasks stay quiet; queued saves still run (1.240042ms)
✔ firstLine recognizes every exported declaration and comment with a word boundary (4308.172209ms)
✔ corpus walk includes .snapback and excludes only target and node_modules (28.170917ms)
✔ corpus walk refuses symlink files, directories, cycles and dangling links loudly (26.338708ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5622.180459
```

### `node --test scripts/affected.test.mjs`

`affected.log`:

```text
✔ editor grammar inputs select the fence with a freshly built CLI (0.393417ms)
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 50060.191334
```

### `node scripts/check-verb-help.mjs`

`verb-help.log`:

```text
changelog verb help: all announced flags present
```

## Development corrections and handoff

The first Unicode incremental-edit witness used a JavaScript character index
where the CLI requires a UTF-8 byte offset; that witness was corrected before
recording its green run. The template fault probe also exposed the CLI's
capture-output variant and now reports the original site. Early unclosed-group
attempts merely removed the hard refusal or tried missing internal terminals;
those still lost the enclosing block. The final explicit local recovery node,
highlight capture and whole-corpus error query are covered together. Their
intermediate outputs remain in the development/debug logs. No failed approach
is counted as passing evidence.

The generator regenerated both grammars and also freshness-checks the first-line
manifest and scanner header. The existing LLP implementation record, editor
READMEs and journal are updated. Prior chunk reports remain historical records.
The orchestrator owns the commit. No marketplace publication, VSIX repackaging,
editor installation, GUI check or change to Rust acceptance is claimed.
