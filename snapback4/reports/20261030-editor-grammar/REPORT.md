# EDITOR1 — Quarry editor grammar, chunk A

Date: 2026-10-30. Base: `cee218b9e96acdc7dc678beaabe5b98fc4be48e3`.
Scope: LLP 3000.041 steps 1–3 and 5, per `LANE-BRIEF.md`.
Changes remain uncommitted. No publication, remote machine, clone, second worktree,
network request other than package installation, or global tool installation.

## Orientation

The full ruled RFC was read before the required fence, lexer/reservation, runner,
and CLI files. Governing context: LLP 3000.041 §2.1/§2.2/§2.4/§8/§9;
LLP 3000 §4 (the independent Snapback 4 fence); LLP 2000.000 §12;
LLP 3000.036.002 §9.1 (builtin reservation must preserve name admission).
The root, design brief and editor RFC are linked from `llp/current/`; none is
in `foundation/`. Current `guide/language.rs` and `guide/types.rs` were also read.
The `llp-orient` hand-off is none: the lane is already commissioned; the local
brief explicitly defers tree-sitter despite the RFC's original combined delivery.

## Step 1 — parser facts and CLI

- Exported lexer facts (`COMMENT`, `TWO_CHARACTER`, `SYMBOLS`,
  `HYPHENATED_WORDS`) and parser classes. Both whole-line and inline comment
  recognition consult `COMMENT`; its spelling remains `--`.
- Added the requested declaration, type, builtin and duration classes from
  actual parser branches, with no language-acceptance change. There are 19
  declaration words, 16 type words, five builtin words, nine duration/schedule
  units, 17 table words, and 115 projected binding/control words.
- Added `grammar --json` (exactly the ten requested fields) and readable
  `grammar`, project-free. The shared command table, validation, top-level
  help and dispatch know the verb. Unknown flags, flag values and positional
  arguments refuse with exit 2. Help, JSON and text were exercised from
  `/private/tmp` without a project.
- The source scan uses `include_str!` for `parser.rs` and all 13 direct parser
  modules. A runtime directory census fails if a new `.rs` is not included.
  It tokenizes Rust strings/comments/char literals, then recognizes string
  match arms (including alternatives/guards), `==`/`!=` comparisons, and
  `at`/`take`/`maybe` helper calls. It checks lowercase Word spellings and the
  three uppercase byte-size units, excluding test modules and diagnostic prose.
  A new word in those idioms fails classification. Self-witnesses cover a
  new match arm, equality and helper call.
- Editor classes are disjoint. A compact commented exception list contains
  refusal-only declaration/rule spellings, unsupported duration aliases,
  the default `schema` filename stem and the explicitly forbidden `system`
  principal. Stale exceptions also fail the test.

### Decisions and deviations

The existing `TABLE_WORDS` and `BINDING_WORDS` are *reservation* sets, not a
complete disjoint lexical taxonomy. They overlap on `insert/update/delete`,
and `BINDING_WORDS` includes the five requested builtins. Removing entries or
adding contextual clause words would change parsing. The reservation sets stay
intact; `CONTEXTUAL_WORDS` names accepted modifiers, and `editor_binding_words()`
projects existing binding plus contextual words, subtracting table words and
builtins. The JSON `binding_words` field is this projection, not a raw copy of
the reservation list. No parser call site starts reserving contextual words.

The illustrative RFC lists are not copied: `proc` and `channel` are refused
forms, `sequence` is a column type form, and general duration literals use
`ms/s/m/h/d`. `month/months/year/years` are accepted only in calendar schedules.
`device` remains in the specifically requested builtin class without changing
its existing reserved/refused behavior. The scanner is intentionally a guard
for the parser's present literal-comparison idiom, not a full Rust analysis of
arbitrary future computed keyword sets.

Two small wiring edits beyond the named `cli_flags.rs` are necessary for the
requested verb: `src/main.rs` dispatches it without supervisor adoption, and
`packages/snapback4/bin/cli-commands.json` admits `--json` in the existing shared
Rust/npm command table. There is no duplicated CLI flag registry.

## Step 2 — TextMate extension and diagnostics

`generate-editor-grammar.mjs` invokes the explicit/default CLI binary, validates
its facts, and writes sorted JSON with stable keyword alternatives and a
versioned generated header. `--binary` and `--output` support alternate binaries
and temporary regeneration. Missing binaries fail loudly. The generated file
uses the RFC scopes for declarations/names, table/control keywords, types,
builtins, numbers/units, comments/strings and operators; member and indexed-read
names have distinct scopes. Whitespace has an explicit scope, with no catch-all
that would conceal an unknown token.

`editors/vscode/` contains the Quarry language registration, `.q` and requested
first-line hint, brackets/comments/auto-close/indentation and continuation rules,
grammar, task provider, on-save task queue, wrapper, README, license and package
ignore rules. A standalone `package.json`/`bun.lock` pins:

| Dependency | Version |
| --- | --- |
| `@vscode/vsce` | 3.6.2 |
| `vscode-textmate` | 9.2.0 |
| `vscode-oniguruma` | 2.0.1 |

`check --json` exists and supplies located `problems` and `notes`; no text
fallback or invented flag was needed. The wrapper runs it from the workspace's
`snapback/` directory and emits one deduplicated located diagnostic per line:

```text
/absolute/file.q:line:col: CODE message | rewrite
```

Message/rewrite whitespace is flattened; sites remain one-based. Unlocated host
or toolchain errors remain on stderr, without fabricated source positions.
Exit status is preserved. `$quarry-check` captures the code and the combined
message/rewrite. A real `read: text` reserved-column refusal proves the shipped
wrapper and matcher agree. Saves coalesce while a check is running; the wrapper
has a five-minute timeout because this loaded debug checkout measured well
above one minute. Node 24 and either the workspace-installed CLI or a configured
`quarry.binary` are required.

VS Code's `firstLine` cannot exclude Q/kdb+ files from the `.q` association;
this platform limitation is stated explicitly with per-workspace override
instructions. The single fixed matcher uses error severity, including for `N_`
advisories; codes remain visible. No claim of completion/hover/navigation or a
language server is made.

The local VSIX is `snapback4/target/quarry.vsix`, built with the pinned local
`vsce` through `bun run package`. Packaging is deliberately separate from the
pure deterministic grammar generator. The version is 0.4.50 and the manifest's
local publisher identity is `snapback4.quarry`; no marketplace-account ownership
or publication is claimed. Dependencies and lockfile are excluded from the VSIX.

## Step 3 — fence and selector

The fence compares regeneration in a temporary directory, checks extension and
grammar versions agree, tokenizes the entire `.q` corpus plus all `quarry` fences
in `guide.rs`, `guide/*.rs`, `guide/*.md`, and the package README, and reports every
unscoped site. Missing dependencies, missing binaries, and empty source/fence
corpora refuse. Explicit scope witnesses and an unknown-punctuation witness
prevent a generic default token from satisfying the check.

The first run found 619 unscoped characters: exclusively `@` and `$` in three
compiler-owned templates (`bind/receipts.q`, `bind/timeline.q`, `recipe/bridge.q`).
Those files are expanded before the parser sees them. Precise `@UPPER_NAME@`
and `$identifier` template scopes now cover their raw source without pretending
those forms are accepted Quarry or skipping the files. No other lexical
fallback was added.

`affected.mjs` selects `editor-grammar` for the requested lexer, parser,
editor, generator and fence paths, plus `parser.rs` itself. It also includes the
fence in broad plans and requires `build-cli` even when no client test happens
to request it. The isolated editor package takes its own fence instead of
widening all product checks; Rust changes retain ordinary reverse-dependency
selection. The selection test covers every trigger and prerequisite order.
No change was made to `scripts/test.sh`; observed fence times varied with build
load, so it is not charged against that suite's 60-second budget.

`--tree-sitter` is an explicit nonzero refusal until chunk B replaces it with
ERROR/MISSING-node checks; default success claims TextMate coverage only.
Fault probes verified stale bytes and both planted unknown-token sites in one
run, and nonzero refusal with missing dependencies and missing binaries. All
probe mutations were restored and temporary source files removed.

## Step 5 — orientation

Added `editors/README.md` with install, regeneration and fence instructions,
a single editor-support link in the package README (9 physical lines against
its 320-line budget), and the requested dated journal entry. Screenshots in
VS Code's light/dark themes and the Problems pane were not taken; the evidence
here is executable tokenization, compiler/matcher integration and local packaging.

## Measurements and verification

All required commands were executed. The scoped editor checks pass. The two
full Cargo test commands exit 101 on three failures also reproduced at the
base commit; this is not a claim that the complete repository suite is green.
JavaScript verification uses the installed Node 24.18.0. Raw development logs
are retained locally in `snapback4/target/editor-grammar-logs/`.

### Check latency (RFC §6)

Command: the absolute `snapback4/target/debug/snapback4 check`, working directory
`snapback4/apps/chat`, timed with Python `time.perf_counter()` around each child.
These were three sequential debug-binary runs under concurrent compilation and
Rust-test load, using the ambient Node 25.9.0 PATH. They include compilation and
analysis, rather than timing a syntax-only checker. They are checkout/load
measurements, not isolated or release-profile performance qualifications.

| Run | Wall clock | Exit |
| --- | ---: | ---: |
| 1 | 57.035035 s | 0 |
| 2 | 94.532304 s | 0 |
| 3 | 70.596196 s | 0 |

Median: 70.596196 s. The compiler reported 56,878.8 / 94,336.1 / 70,495.5 ms,
five tables, one view and 12 operations, with eight nonblocking advisories.
These measurements do not establish a subsecond edit/check loop. The wrapper's
five-minute timeout and coalesced save queue accommodate the observed debug
runs; no compiler performance change is included in this lane.

The final restored-source TextMate fence took 4,897 ms. Earlier passing runs
ranged from 3,255 to 16,516 ms during compilation/testing. It is deliberately
absent from `scripts/test.sh`; a consistent under-five-second budget has not
been established.

### Outcomes and limits

| Required command | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass; rebuilt after restoring lane sources |
| `cargo test -p snapback4-lang` | Exit 101: two existing generated-TypeScript `#fetch` resolution failures; the new parser classification test passes |
| `cargo test -p snapback4` | Exit 101: one existing macOS background-policy permission failure; 692 passed, 83 ignored, including all five CLI flag/help tests |
| `node scripts/check-editor-grammar.mjs` | Pass: 1,136 `.q` files, 215 Quarry fences, zero failures |
| `node scripts/check-verb-help.mjs` | Pass |
| `node scripts/docs-budget.mjs` | Pass: README 9/320 lines; named guide test passes |
| `node --test scripts/affected.test.mjs` | Pass: 43 tests |
| `node scripts/affected.mjs --worktree` | Pass: listing only; 27 commands, six whole Rust packages, 476 client files |

The full CLI test command used `RUST_MIN_STACK=33554432` and
`-- --test-threads=1`, consistent with this workspace's large-stack test needs.
Cargo stops at the failing test executable, so later language integration
executables were not all reached. The CLI flag/help assertions all passed:

```text
test cli_flags::integration_tests::wave9_web_flags_and_upgrade_keep_shared_validation ... ok
test cli_flags::projection_tests::every_validated_flag_is_in_its_generated_help ... ok
test cli_flags::surface_parser_tests::every_flag_round_trips_through_options_with_its_declared_arity ... ok
test cli_flags::surface_tests::every_help_and_usage_projects_the_same_synopsis ... ok
test cli_flags::surface_tests::ignored_flags_refuse_before_any_work ... ok
```

The affected plan includes Lean builds, differential runs, WASM measurement,
all reverse-dependent Rust packages and hundreds of client files. Running all
27 commands is not reasonable for this editor lane; the conditional `--run`
was not invoked. The complete product battery is unclaimed.

### Verbatim command tails

`cargo build -p snapback4` (`build-cli-restored.log`):

```text
   |
96 | pub(super) fn exposure(report:&Report){
   |               ^^^^^^^^

warning: `snapback4` (bin "snapback4") generated 30 warnings (run `cargo fix --bin "snapback4" -p snapback4` to apply 2 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 7.75s
```

`cargo test -p snapback4-lang` (`test-lang.log`):

```text
thread 'generated_typescript_preserves_strings_and_typechecks_with_the_real_contract' (359624563) panicked at crates/snapback4-lang/tests/frontend_regressions.rs:817:5:
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/auth.ts(4,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/client.ts(36,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/local.ts(50,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.



failures:
    generated_nullable_arrays_typecheck_with_the_real_contract
    generated_typescript_preserves_strings_and_typechecks_with_the_real_contract

test result: FAILED. 38 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.32s

error: test failed, to rerun pass `-p snapback4-lang --test frontend_regressions`
```

`RUST_MIN_STACK=33554432 cargo test -p snapback4 -- --test-threads=1` (`test-cli.log`):

```text

failures:

---- verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child stdout ----

thread 'verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child' (359694553) panicked at crates/snapback4/src/verbs/witness/background.rs:497:27:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_PROCESS: cannot set background policy on owned app: Operation not permitted (os error 1)"


failures:
    verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child

test result: FAILED. 692 passed; 1 failed; 83 ignored; 0 measured; 0 filtered out; finished in 295.89s

error: test failed, to rerun pass `-p snapback4 --bin snapback4`
```

`node scripts/check-editor-grammar.mjs` (`editor-fence-delivery.log`):

```text
editor grammar: 1136 .q files, 215 quarry fences, 0 failures; 4897 ms (TextMate; chunk B tree-sitter pending)
```

`node scripts/check-verb-help.mjs` (`verb-help-delivery.log`):

```text
changelog verb help: all announced flags present
```

`node scripts/docs-budget.mjs` (`docs-budget.log`):

```text
    |
    = note: `#[warn(unused_variables)]` (part of `#[warn(unused)]`) on by default

warning: `snapback4-lang` (test "guide") generated 1 warning (run `cargo fix --test "guide" -p snapback4-lang` to apply 1 suggestion)
    Finished `test` profile [optimized + debuginfo] target(s) in 10m 07s
     Running tests/guide.rs (target/debug/deps/guide-bd2188eb6897b804)
```

The budget command buffers stdout before stderr, so its passing summary is
at the start rather than the warning-heavy tail:

```text
docs budget: README 9/320 physical lines

running 1 test
test w14b_first_account_screen_is_self_contained ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 134 filtered out; finished in 0.01s

```

`node --test scripts/affected.test.mjs` (`affected-tests.log`):

```text
✔ Rust guide implementation snapback4/crates/snapback4-lang/src/guide/codes.rs retains reverse dependencies (0.193167ms)
✔ embedded init template day2-proof.mjs selects its binary source and consumers (0.183417ms)
✔ embedded init template previous/day2-proof-0.4.40.mjs selects its binary source and consumers (0.172875ms)
✔ guide integration modules and named fixtures select their compiled consumer (0.307917ms)
✔ filesystem issue records require reference validation without widening product scope (0.063833ms)
✔ editor grammar inputs select the fence with a freshly built CLI (0.233ms)
ℹ tests 43
ℹ suites 0
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 63125.944875
```

`node scripts/affected.mjs --worktree` (`affected-plan-delivery.log`):

```text
(cd '.' && timeout 900s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' 'scripts/generate-diagnostics-registry.mjs' '--check')
(cd 'snapback4' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' 'scripts/docs-budget.mjs')
(cd 'snapback4' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' 'scripts/check-editor-grammar.mjs')
(cd '.' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'bash' 'scripts/check-generated-artifacts')
(cd '.' && timeout 900s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' 'scripts/check-guide.mjs')
(cd '.' && timeout 900s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' 'scripts/check-inventories.mjs')
(cd 'snapback4' && timeout 300s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' '--input-type=module' '-e' 'import { lintPackagedDocs } from '\''./scripts/packaged-docs.mjs'\''; lintPackagedDocs(process.cwd());')
(cd '.' && timeout 300s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 './ref-check')
(cd '.' && timeout 300s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'node' '--test' 'snapback4/scripts/affected.test.mjs' 'tests/local_proof_selection_v0.mjs' 'tests/local_proof_inventory_v0.mjs' 'tests/ci_workflows_v0.mjs')
(cd 'snapback4' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'bash' 'scripts/measure-wasm.sh' '--no-record')
(cd 'snapback4/lean' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'lake' 'build')
(cd 'snapback4' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'cargo' 'run' '--release' '-p' 'snapback4-difftest' '--' 'run-lean' '--seed' '0' '--cases' '2000' '--workers' '2' '--out' 'target/affected/difftest-run-lean')
(cd 'snapback4' && timeout 10800s env RUST_MIN_STACK=33554432 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 'cargo' 'run' '--release' '-p' 'snapback4-difftest' '--' 'run' '--seed' '0' '--cases' '2000' '--workers' '2' '--out' 'target/affected/difftest-run')
# 27 commands, 6 whole Rust packages, 476 client files; broad=false
```

### Base-commit replay

To distinguish inherited failures from this delta, all nine changed tracked
implementation/documentation files then present were temporarily replaced with
`git show cee218b9e9:<path>` bytes in this same worktree. No index, branch, commit
or worktree operation occurred. The replay ran the two failing test targets and
restored all nine lane files byte-for-byte in `finally`; the durable
`baseline-replay.json` records `restored: true`. New editor files are not compiled
by these baseline Rust targets. The journal entry was appended afterward.
The final CLI was then rebuilt from the restored lane sources and the editor
fence and verb-help checks passed again.

Both generated-TypeScript tests reproduce TS2307 for `#fetch` in existing
`auth.ts`, `client.ts` and `local.ts`. The witness test reproduces
`E_WITNESS_PROCESS` / `Operation not permitted (os error 1)` when macOS refuses
background policy on its owned child. None of those implementation/test files
was changed by this lane. Base replay tails:

`cargo test -p snapback4-lang --test frontend_regressions generated_ -- --nocapture` (`base-frontend.log`, exit 101):

```text
test generated_nullable_arrays_typecheck_with_the_real_contract ... FAILED

thread 'generated_typescript_preserves_strings_and_typechecks_with_the_real_contract' (359755492) panicked at crates/snapback4-lang/tests/frontend_regressions.rs:817:5:
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/auth.ts(4,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/client.ts(36,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.
../../../../../../../Users/ccheever/projects/snapback-quarry-grammar/snapback4/packages/snapback4/src/local.ts(50,30): error TS2307: Cannot find module '#fetch' or its corresponding type declarations.

test generated_typescript_preserves_strings_and_typechecks_with_the_real_contract ... FAILED

failures:

failures:
    generated_nullable_arrays_typecheck_with_the_real_contract
    generated_typescript_preserves_strings_and_typechecks_with_the_real_contract

test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 37 filtered out; finished in 1.42s

error: test failed, to rerun pass `-p snapback4-lang --test frontend_regressions`
```

`cargo test -p snapback4 --bin snapback4 verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child -- --exact` (`base-witness.log`, exit 101):

```text
test verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child ... FAILED

failures:

---- verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child stdout ----

thread 'verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child' (359770200) panicked at crates/snapback4/src/verbs/witness/background.rs:497:27:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_PROCESS: cannot set background policy on owned app: Operation not permitted (os error 1)"
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    verbs::witness::background::tests::background_policy_can_be_applied_to_an_owned_external_child

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 775 filtered out; finished in 0.05s

error: test failed, to rerun pass `-p snapback4 --bin snapback4`
```

After restoration, `RUST_MIN_STACK=33554432 cargo test -p snapback4-lang --lib`
also passed, including the keyword-classification test. Verbatim tail from
`test-lang-lib-delivery.log`:

```text
test bind::security::derived::approval_questions::tests::approval_questions_have_actual_targeted_replays ... ok
test bind::security::derived::transition_questions::tests::actual_committed_edges_and_minimal_repairs ... ok

test result: ok. 214 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 28.50s
```

### Packaging and negative controls

Local `bun run package` (pinned `@vscode/vsce`, exit 0), verbatim tail:

```text
├─ [Content_Types].xml 
├─ extension.vsixmanifest 
└─ extension/
   ├─ LICENSE.txt [1.05 KB]
   ├─ extension.cjs [2.77 KB]
   ├─ language-configuration.json [0.97 KB]
   ├─ package.json [2.41 KB]
   ├─ readme.md [3.01 KB]
   ├─ scripts/
   │  └─ check-problems.mjs [3.49 KB]
   └─ syntaxes/
      └─ quarry.tmLanguage.json [4.66 KB]

 DONE  Packaged: ../../target/quarry.vsix (9 files, 9.67 KB)
```

The archive was inspected: nine files, 9,897 bytes, no `node_modules`,
manifest version 0.4.50, with the runtime wrapper and generated syntax included.
All six runtime/configuration/README/grammar payloads match the final source bytes.
The build-instructions link is absolute so VSCE cannot rewrite it against the
repository root. The artifact is
`target/quarry.vsix`; it was neither installed in an editor nor published.
Package installation initially hit a sandbox temp-directory permission refusal;
retrying with `TMPDIR=/private/tmp` and a cache under `/private/tmp` succeeded.
No global package was installed.

The CLI probes exercised JSON/text/help, unknown switches, extra positional
arguments and `--json=yes`. All refusals had exit 2. Generator/fence probes for
an absent binary, absent installed dependencies and `--tree-sitter` all failed
nonzero. A stale grammar byte plus two unknown characters produced all three
failures in one run, rather than stopping after the first site:

```text
editor grammar: 1137 .q files, 215 quarry fences, 3 failures; 11869 ms (TextMate; chunk B tree-sitter pending)
editor grammar: committed grammar differs: run node scripts/generate-editor-grammar.mjs
editor grammar: editors/vscode/unknown-probe.q:1:1: unscoped "§"
editor grammar: editors/vscode/unknown-probe.q:2:1: unscoped "€"
```

All probe mutations were restored, the temporary `.q` was removed, and the
clean fence was rerun. Empty-corpus guards refuse both zero files/fences and
corpora consisting only of empty source text; no corpus deletion was needed
to verify the normal path. `git diff --check` passes. No commit was created.

## Chunk B and follow-up

Implement the tree-sitter grammar and indentation scanner, generate its keyword
tables from the same CLI facts, and replace the explicit `--tree-sitter` refusal
with corpus/fence parsing and ERROR/MISSING-node checks. The three raw compiler
templates need an explicit handling decision; this chunk has not modified or
expanded them for tree-sitter. Current coverage is 1,136 `.q` files and 215 guide
fences, not the RFC's older count of 91 fences. The current short package README
has no `quarry` fences; its fence extractor remains active for future examples.

Manual editor theme/Problems screenshots remain unclaimed. Marketplace/Open VSX
publication and Linguist registration remain outside engineering chunk A.
