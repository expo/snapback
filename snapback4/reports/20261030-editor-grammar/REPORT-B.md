# LLP 3000.041 — editor grammar, chunk B

Implemented 2026-10-30 on chunk A commit `2d45b71e0e`. No commit was made.
The orchestrator owns the landing. No Rust lexer/parser/CLI source or TextMate
artifact was changed. The concurrent chunk-A implementation-record edits in
`llp/3000.041-quarry-editor-grammar.rfc.md` were observed and left untouched.

## Scope and governing context

The context pack is limited to `snapback4/editors/`, the generator/fence and
selection test. LLP 3000 (current working set) supplies the Snapback 4 fence;
LLP 3000.041 (current, commissioned Draft) §2.3 defines a highlighting grammar,
§2.4 defines ERROR/MISSING coverage and §9 ruling 1 commissions this step.
LLP 0189 (foundation) keeps this an affected check, without a complete-battery
or exact-HEAD gate. The current language and jobs guide cards were read before
implementation. No new design decision or LLP is needed; hand-off: none.

## What was built

- `editors/tree-sitter-quarry/grammar.js` contains hand-written declarations,
  table-head lines, statements, nested blocks, loose expression sequences,
  calls/index reads, properties, groups, shapes, literals and comments.
  `keywords.generated.js` is a separate deterministic projection of
  `target/debug/snapback4 grammar --json`. The existing generator now emits
  both artifacts; `--keywords-output` supports temporary regeneration.
- The Rust parser remains the only acceptance authority. This grammar does not
  check operand validity, precedence, keyword context, types, rules or binding.
  It intentionally colors some Rust-refused fixtures cleanly. There is no
  arbitrary-character fallback: unknown punctuation and malformed layout,
  strings and grouping still produce parse errors.
- `src/scanner.c` handles layout, grouping and whitespace, with comments citing
  `crates/snapback4-lang/src/lexer.rs` at each rule. Its state is fully serialized
  for incremental reparsing. The extra external bracket/soft-newline/whitespace
  tokens allow grouping and comments to remain correctly highlighted.
- The standard captures are `@keyword`, `@type`, `@variable.builtin`, `@comment`,
  `@string`, `@number`, `@operator`, `@property`, `@function`, plus ordinary
  `@variable`. Declaration names and indexed-table names mirror TextMate's type
  scopes; member/label captures refine lexical classes. Fold and Neovim-style
  indent queries are included and compiled by the fence.
- The standalone package pins `tree-sitter-cli` **0.25.10**, with `bun.lock` and
  its trusted install script. `generate`, `test` and `parse-corpus` scripts use
  the local executable. Generated parser C, headers, grammar/node metadata,
  libraries, caches/build directories and dependencies stay ignored.
- Twelve tree-sitter corpus cases contain eleven exact declaration excerpts
  from the chat schema and three `.q` fixtures, plus the calendar schedule from
  the compiled language guide (there was no calendar schedule in the `.q`
  fixtures). Cases cover table rules, first/by/after pagination, require/insert,
  require/update, a view, a job, an effect, a shape, continuation, a helper loop
  and a calendar month. Titles record their source. Nineteen additional layout
  tests check edge cases and incremental edits.
- The default `scripts/check-editor-grammar.mjs` now runs both grammars. The
  tree-sitter implementation lives in the editor package's `check.mjs`, so the
  existing `editors/**` affected selector already covers it. The selection test
  now explicitly includes grammar/tables/scanner/queries/exceptions/tests/helper,
  manifest and lockfile paths; `build-cli` remains its prerequisite.
- `editors/README.md` and the grammar README explain generation, diagnostics,
  exceptions and manual Neovim/Helix/Zed integration. The native shared-library
  build in the Neovim instructions was executed successfully. No editor GUI
  installation was performed. Zed's source-only checkout needs generation in
  its fetched grammar directory before its C-to-WASM build; the README states
  this explicitly instead of claiming a ready distributed extension.

## Scanner mapping to lexer.rs::lex

| Rust rule | External scanner implementation and witness |
| --- | --- |
| Normalize CRLF/lone CR to LF | `skip_eol` consumes either physical form; both have passing tests. |
| Ignore `raw.trim_start()` blank and `--` lines | Newline lookahead crosses ignored lines without changing the indent stack. The marked token end stays before the comments, which remain named extras. Tests cover deeper/shallower comments, blank lines, tabs and Unicode White_Space on ignored lines. |
| Spaces-only indentation; tabs allowed between tokens | Significant leading tabs are refused, including inside groups and before a negative value. External whitespace admits inline tabs. Unicode whitespace is admitted only on ignored lines, matching Rust's trim-before-diagnose ordering. |
| Greater indentation pushes; smaller indentation pops to an enclosing level | A pending target emits INDENT or one DEDENT at a time. Nonmatching dedents refuse. Nested job/if/for corpus cases and an unmatched-dedent negative case exercise this. |
| `([{` increment and `)]}` decrement grouping; grouping suspends newlines/layout | External bracket tokens keep the counter; soft newlines inside groups do not alter indentation. String and comment delimiters never reach the counter. One test nests all three bracket kinds over lines with misleading delimiters in strings/comments. |
| A deeper line beginning `{`, exact `and ` or exact `or ` removes the prior newline and keeps the stack | Lookahead returns a soft newline only with a pending significant line and a deeper prefix. Tests distinguish comments/blanks, same-depth forms, `andrew`/`orbit`, tab separators and a leading minus. |
| Emit a significant final newline even without LF; flush dedents at EOF | Zero-width final NEWLINE then outstanding DEDENT tokens. No-final-LF and multiple nested blocks are exercised; unclosed grouping refuses. |
| Incremental editor state (tree-sitter requirement) | Serialize/restore stack, grouping and pending target; incremental edits changing continuation, grouping and dedentation match fresh parses. |

Tree-sitter limits scanner serialization to 1,024 bytes. The scanner stores
252 indentation levels including root (251 nested blocks); an unrepresentable
stack refuses rather than being silently truncated. This is an explicit editor
implementation limit, not a change to Rust's admission. No corpus file hits it.

## Exceptions and fence behavior

All **1,136** `.q` files and **215** published Quarry fences are parsed. The same
enumeration as TextMate excludes `target/`, `node_modules/` and `.snapback/`.
The three expected-error paths, relative to `snapback4/`, are:

| Path | Reason and verification |
| --- | --- |
| `crates/snapback4-lang/src/bind/receipts.q` | Compiler-owned `@NAME@` and `$name` pre-expansion template. `bind/receipts.rs` includes the file, allocates/replaces `$` locals and substitutes `@` slots before parsing. The fence observed ERROR nodes. |
| `crates/snapback4-lang/src/bind/timeline.q` | Compiler-owned `@T@` template. `bind/timeline.rs` includes/replaces it before parsing. The fence observed ERROR nodes. |
| `crates/snapback4-lang/src/recipe/bridge.q` | Compiler-owned `@PREFIX@`/`$name` template. `recipe/bridge.rs` includes it, replaces the prefix and allocates local names. The fence observed ERROR nodes. |

**No syntax-refusal fixtures are listed**, so there is no unverified Rust
refusal/code claim. No Rust-accepted ordinary source was excepted. The template
class is confined to the three permitted paths. If a future fixture exception
is added, the helper requires a `syntax E_QUARRY_SYNTAX:` reason and invokes the
Rust CLI to verify that diagnostic; semantic errors cannot qualify.

The fence compares both generated artifacts byte-for-byte, copies structural
sources and tests to a temporary directory, generates parser C there, probes an
actual C compilation, then runs the corpus and layout tests. It checks CLI
package and executable versions against the pin and compiles every query.

A CLI JSON census accounts for every input, including success booleans based on
both error and missing nodes. Each unsuccessful tree is then queried with
`(ERROR) @error` and `(MISSING) @missing`; this finds every site, including
unnamed missing terminals. Output is one-based `file:line:col` (tree-sitter byte
columns), with guide line offsets restored. The CLI's first-error summary alone
is not used as the location report. Ordinary corpus/layout test failures are
collected rather than preventing the complete source census. A listed clean parse is a stale exception;
a listed nonexistent/un-enumerated path is an error.

One-time fault probes ran against temporary copies, without altering product
sources: both distinct planted error sites were reported even with a planted corpus-test
red; stale and missing
exceptions, empty corpus, missing compiler and missing local CLI refused. A
wrapper supplying one changed lexical fact made the real fence exit 1 and
report drift in both generated artifacts. Raw logs are in
`target/editor-grammar-b-logs/`. Scanner C also passes `-Wall -Wextra -Werror`.

## Measurements

Host: this macOS arm64 workspace. Node **24.19.0**, Bun **1.4.2**, tree-sitter
**0.25.10**, Apple clang **21.0.0**. No global dependency installation, agent,
remote machine, clone or second worktree was used. Bun's install cache/temp path
was redirected into writable `/private/tmp`; frozen install passed afterward.
No C-toolchain limitation remained.

The following are sequential subprocess wall clocks from `time.monotonic()`.
These are local debug-checkout measurements, not performance qualification:

| Command | Wall seconds | Exit |
| --- | ---: | ---: |
| `node scripts/generate-editor-grammar.mjs` | 0.269331 | 0 |
| `node_modules/.bin/tree-sitter generate` | 0.145629 | 0 |
| `node_modules/.bin/tree-sitter test` | 0.610598 | 0 |
| `bun run test` | 1.449191 | 0 |
| `node scripts/check-editor-grammar.mjs --textmate-only` | 4.640495 | 0 |
| `node scripts/check-editor-grammar.mjs` | 14.517090 | 0 |

The first passing measurement pair was **5.791094 s** for both grammars versus
**3.410165 s** without tree-sitter (about 2.38 seconds difference); internal totals
were 5,704/3,350 ms, with tree-sitter at 2,246 ms. A final change ensures corpus
reporting continues after ordinary test reds; its required retest measured
**14.517090 s** for both grammars versus **4.640495 s** without, internal totals
14,329/4,384 ms and tree-sitter at 5,335 ms. Host-load variability is visible even
in the unchanged TextMate stage; these pairs do not establish a stable overhead
or latency bound. The table and command tails show the final run. The default
fence always includes tree-sitter. `--textmate-only` is explicitly labeled as
partial coverage for measurement/bisection. This does not add a complete-battery
or publication claim.

## Verbatim command tails

Commands used Node 24 on PATH and the pinned local tree-sitter executable.
`tree-sitter generate` exited **0**, in **0.145629 s**, and emitted no stdout or
stderr (`target/editor-grammar-b-logs/generate.txt` is empty). Its generated
`parser.c` was subsequently compiled and used by the commands below.

### `tree-sitter test` — exit 0

```text
  real-files:
      1. ✓ Table with access rules — apps/chat/snapback/schema.q
      2. ✓ Projection continuation — apps/chat/snapback/schema.q
      3. ✓ Require and insert — apps/chat/snapback/schema.q
      4. ✓ Require and update — apps/chat/snapback/schema.q
      5. ✓ Shape literal — apps/chat/snapback/schema.q
      6. ✓ First N by index after cursor — crates/snapback4-lang/tests/fixtures/shape-overrides.q
      7. ✓ View and and-continuation — crates/snapback4-lang/tests/fixtures/row-keyed-view.q
      8. ✓ Effect declaration — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
      9. ✓ Job sweep with emit — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
     10. ✓ Function and loop — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
     11. ✓ Shape declaration — crates/snapback4-lang/tests/fixtures/shape-overrides.q
     12. ✓ Calendar month schedule — crates/snapback4-lang/src/guide/language.rs

Total parses: 12; successful parses: 12; failed parses: 0; success percentage: 100.00%; average speed: 3108 bytes/ms

```

### `bun run test` — exit 0

```text
✔ Unicode whitespace on ignored lines matches Rust trim_start (9.269709ms)
✔ inline tabs are allowed (8.816875ms)
✔ empty and comment-only files (10.180209ms)
✔ final significant line without LF (11.97125ms)
✔ CRLF normalization (9.538291ms)
✔ lone CR normalization (9.941666ms)
✔ deeper shape, and-space and or-space continue across blank/comments (30.359542ms)
✔ same-depth and/or, prefixes and tab separators do not continue (53.625083ms)
✔ tab indentation produces a parse error (7.189208ms)
✔ Unicode whitespace is not indentation produces a parse error (7.3275ms)
✔ tabs before negative value produces a parse error (11.060583ms)
✔ tabs inside grouping produces a parse error (9.541584ms)
✔ dedent outside enclosing levels produces a parse error (9.790167ms)
✔ unclosed grouping produces a parse error (9.302084ms)
✔ unclosed string produces a parse error (8.693958ms)
✔ unknown punctuation at multiple sites produces a parse error (9.158583ms)
✔ scanner serialization survives incremental changes to layout and grouping (59.836625ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 844.302708
```

### `node scripts/check-editor-grammar.mjs` — exit 0

```text
tree-sitter generate: exit 0 (temporary build)
real-files:
      1. ✓ Table with access rules — apps/chat/snapback/schema.q
      2. ✓ Projection continuation — apps/chat/snapback/schema.q
      3. ✓ Require and insert — apps/chat/snapback/schema.q
      4. ✓ Require and update — apps/chat/snapback/schema.q
      5. ✓ Shape literal — apps/chat/snapback/schema.q -- Warning: Slow parse rate (55.287 bytes/ms)
      6. ✓ First N by index after cursor — crates/snapback4-lang/tests/fixtures/shape-overrides.q
      7. ✓ View and and-continuation — crates/snapback4-lang/tests/fixtures/row-keyed-view.q
      8. ✓ Effect declaration — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
      9. ✓ Job sweep with emit — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
     10. ✓ Function and loop — crates/snapback4-lang/tests/fixtures/qe/helper-sweep.q
     11. ✓ Shape declaration — crates/snapback4-lang/tests/fixtures/shape-overrides.q
     12. ✓ Calendar month schedule — crates/snapback4-lang/src/guide/language.rs

Total parses: 12; successful parses: 12; failed parses: 0; success percentage: 100.00%; average speed: 594 bytes/ms
✔ blank and comment lines ignore their indentation (815.028291ms)
✔ all grouping kinds suppress layout; strings and comments do not alter grouping (63.405584ms)
✔ Unicode whitespace on ignored lines matches Rust trim_start (24.094334ms)
✔ inline tabs are allowed (14.326209ms)
✔ empty and comment-only files (19.535834ms)
✔ final significant line without LF (16.813959ms)
✔ CRLF normalization (40.525791ms)
✔ lone CR normalization (41.693792ms)
✔ deeper shape, and-space and or-space continue across blank/comments (59.200958ms)
✔ same-depth and/or, prefixes and tab separators do not continue (86.266333ms)
✔ tab indentation produces a parse error (14.268458ms)
✔ Unicode whitespace is not indentation produces a parse error (13.31275ms)
✔ tabs before negative value produces a parse error (12.618917ms)
✔ tabs inside grouping produces a parse error (12.25225ms)
✔ dedent outside enclosing levels produces a parse error (12.717292ms)
✔ unclosed grouping produces a parse error (22.436917ms)
✔ unclosed string produces a parse error (17.361542ms)
✔ unknown punctuation at multiple sites produces a parse error (24.776875ms)
✔ scanner serialization survives incremental changes to layout and grouping (118.034292ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1533.855208
tree-sitter: 1136 .q files, 215 quarry fences, 3 verified expected-error files; 5335 ms
editor grammar: 1136 .q files, 215 quarry fences, 0 failures; 14329 ms (TextMate + tree-sitter)
```

### `node scripts/check-editor-grammar.mjs --textmate-only` — exit 0

```text
editor grammar: 1136 .q files, 215 quarry fences, 0 failures; 4384 ms (TextMate only; tree-sitter NOT checked)
```

### `node --test scripts/affected.test.mjs` — exit 0

```text
✔ embedded init template previous/day2-proof-0.4.40.mjs selects its binary source and consumers (0.047375ms)
✔ guide integration modules and named fixtures select their compiled consumer (0.196792ms)
✔ filesystem issue records require reference validation without widening product scope (0.038208ms)
✔ editor grammar inputs select the fence with a freshly built CLI (0.228416ms)
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36385.7155
```

### `node scripts/check-verb-help.mjs` — exit 0

```text
changelog verb help: all announced flags present
```

## Remaining scope and non-claims

The required chunk B implementation and verification are complete. All 43
affected-selection tests pass; the existing broad `editors/**` trigger needed
no selector-code change. No compiler acceptance, runtime behavior, core client,
publication pipeline or global tool installation changed. Known base Rust test
reds and the Chromium sandbox artifact were not retested, since this change
has no Rust or browser implementation delta. There is no full-product-suite
claim. Editor UI behavior, distributed grammar artifacts, marketplace/Open VSX
publication and Linguist registration remain outside this lane. Changes are
uncommitted for the orchestrator.
