# Lane QE — round 2, 0.4.5

2026-09-27. Branch `sb4-intent/qe-quarry-ergonomics`. Read the original lane
prompt, both earlier reports and journal entries, and both complete round-1
reviews. First fetched and merged `origin/main` **54099bc88** as **ccb09c02a**;
the two journal conflicts retain both sides verbatim. Implementation head:
**55e8c29af**. No push or publication. All round-2 commits, including the merge,
carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

## Findings and commits

| Finding from the round-2 prompt | Commit | Resolution |
| --- | --- | --- |
| 1 (Astra Medium), 4 (Grok widening Low) | `89320fcb9` | Join enum/text to sufficient bounded text, generic id/reference or principal to id, int/decimal or money to that numeric type, and json/known non-row values to json. Preserve strict incompatible-item, mixed-table reference, row-kind and Unknown refusals. |
| 2 (Astra repair Low) | `0fca2518f` | The mixed-reference diagnostic and executable types-card example teach `exposedId`, including projected and nested `[].id` repairs. |
| 3 (Astra purity coverage), 5 (Grok test strength) | `2d233ce8d` | Direct/transitive connection and minted-id refusal regressions, plus the reviewer's `exists`/delete program. Each specific purity mutation fails its new test. No production purity change was needed. |
| 6 (Grok doubled-diagnostic Low) | `55e8c29af` | Restrict recursive-growth rewrites to assignment joins/rebindings after the value typechecks. Ill-typed operands keep one original diagnostic; genuine recursive growth retains its rewrite. |

## Changes, file by file

Paths are relative to `snapback4/` except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/types.rs` | Explicit representation-preserving common types before the strict fallback. Enum widening uses the same character-domain rule as assignment and a bound at least as large as both operands. A structured mixed-reference marker survives nested join paths. |
| `crates/snapback4-lang/src/bind/program/joins.rs` | Mixed-reference refusals teach the generic-id helper and its use for flat and projected IDs; scalar conflicts retain compatible-item guidance. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Apply recursive-list guidance only at append/reassignment type failures, after successful expression lowering. |
| `crates/snapback4-lang/src/guide/types.rs` | Compiled flat and nested generic-id repair; trimmed repeated introductory wording to preserve the existing aggregate word budget and all 133 fact homes. |
| `crates/snapback4-lang/tests/list_widening.rs` | Six tests: enum character bounds/domain; generic IDs; decimal/money representation; json/Unknown boundary; exact reviewer literals and bounded text helper. |
| `crates/snapback4-lang/tests/list_reference_repair.rs` | Three tests: located flat/nested diagnostic repair; exact runtime IDs for flat, nested and row-projected repairs; standalone compilation of the documented repair. |
| `crates/snapback4-lang/tests/pure_call_narrowing.rs` | Three tests: direct/transitive connection reads, `exists` across deletion, and direct/transitive minted IDs cannot narrow repeated calls. |
| `crates/snapback4-lang/tests/list_expressions.rs` | One regression covers four ill-typed assignment forms, requiring exactly one original operand error, and runs the valid self-append repair. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | §5.1 records common scalar types, the explicit ID repair and the expression/assignment diagnostic boundary; revision history updated. |
| `../issues/20260927-snapback4-react-journal-admission-invalidation-timeout.md` | Record the full-suite baseline timeout, evidence and reproduction without changing the unrelated test. |
| `JOURNAL.md`, this report | One new dated round-2 journal append and the complete evidence report. Existing journal entries are unchanged. |

No engine, authorization, disclosure, durability, IR-format, runtime-meter,
version or budget change. No new diagnostic code or dependency. Every changed
source file remains below 1,500 lines. The types-card lead stays below 45 words;
all original compiled guide blocks remain.

## Forms that compile and run

Each widening runs in both operand orders as `[a, b]`, `[a] + [b]`, and
`xs = [a]` followed by `xs = xs + [b]` inside a loop. The loop retains `Push`.
The tests assert inferred item types/bounds and exact returned values.

| Form | Example and result |
| --- | --- |
| Enum/text literal | `count([a, 'off'])`, `a: enum('on', 'off')`, returns `2` for `'on'`. |
| Enum/text concatenation | `[a] + [b]`, `a: enum('on', 'off')`, `b: text <=1`, infers `[text <=3] <=2`; `'off'` and `'x'` return unchanged. Unicode variants count characters, not UTF-8 bytes. |
| Enum self-append | Start `xs = [a]`, then append `[b]` in a loop with those same declarations: `['off', 'x']`. |
| Generic id/reference | `[a, b]`, `a: id`, `b: t`, returns the two original IDs with item type `id`. The inverse operand order also works. |
| Decimal/int | `[a, 0]`, `a: decimal 2`, returns `[123, 0]` for stored integer `123`; no rescaling. |
| Money/int | `[a] + [b]`, `a: money USD`, `b: int`, retains `money USD 2` and the integer values. |
| Json/int | `[a, 0]`, `a: json <=100`, returns `[true, 0]` for `true`. |
| Bounded text helper | `lowerAll([a, 'a'])`, `a: enum('ON', 'OFF')`, with parameter `[text <=10] <=2`, returns `['off', 'a']`. |
| Intentional mixed-reference repair | Declare `fn exposedId(value: id): value`, then `[exposedId(x), exposedId(y)]`; both IDs remain unchanged. Nested `[{ id: exposedId(x) }, { id: exposedId(y) }]` and `exposedId(row.id)` projections also run. |
| Correct arithmetic append | `xs = xs + [i + 1]` over `[1, 2]`, starting with `[1]`, returns `[1, 2, 3]`. |

`[1, 'x', 2]`, the round-0 arithmetic `E_TYPE` reproduction, references to
different tables, nonempty Unknown joins and row-kind conflicts remain compile
errors. `xs = [xs] + []`, `xs = xs + [xs]`, conditional recursion and mutually
recursive accumulators retain the fixed-item self-append rewrite.

`xs = [xs + 1]`, `[xs + 1] + [xs]`, a conditional containing that bad operand,
and `[xs] + 1` each produce exactly one `E_QUARRY_TYPE`, at the operand site:
`+ concatenates two lists`, with the `xs + [x]` repair.

## Regression and affected evidence

Raw logs and the repeatable corpus probe are under ignored `target/lane-qe-r2/`.

| Evidence | Result |
| --- | --- |
| `regressions-before.log` | On the pre-fix implementation, five new widening tests fail with the reported strict-join refusals and the diagnostic-count test fails with two errors. Existing controls pass. |
| `widening-after-repair-before.log` | Widenings pass 6/6; new diagnostic/card repair assertions fail before the repair change; the existing explicit ID workaround already runs. |
| `purity-connected-mutation.log` | Changing only `Builtin::Connected => false` to true makes the new test fail because the unsafe program compiles. |
| `purity-exists-mutation.log` | Classifying only `Expr::Exists` as pure makes the reviewer's `has(key)` test fail because it compiles across deletion. |
| `purity-new-id-mutation.log` | Classifying only `Input::NewId` as pure makes the minted-ID test fail because the repeated call narrows. |
| `affected-compiler.log` | **165/165**: whole guide 86, control flow 1, frozen compatibility 1, historical ergonomics 22, helper placement 8, joined shapes 17, list expressions 13, repairs 3, widenings 6, pure calls 8. |
| `affected-engine.log` | **1/1**: helper and inline jobs emit identical payloads across multiple committed chunks. |
| `affected-readauth.log` | **81/81**, including the unchanged authoring census. |
| `ref-check-final.log` | **517 LLP documents, 9,617 references, zero errors or unchecked references**, after the report/journal append. |

All three mutations were restored byte-for-byte before committing. No test or
source mutation remained during affected qualification or the full suite.
Guide development checks caught the new text exceeding its word target and the
removal of a repeated but pinned fact. Restored the fact and shortened redundant
wording; all guide checks pass without changing baselines, counts or budgets.

## App and calibration compatibility

The probe compiles every Quarry source under `apps/` and
`benchmarks/runs/*/astra/source/`, grouped by its source directory. For the
baseline pass it substitutes the four changed compiler/guide source files from
merged pre-fix **ccb09c02a**, builds the compiler and records its results; it
then restores the final source, rebuilds and compares. Exact equality includes
all operation names, diagnostics (code, site, message, rewrite) and notes.
Temporary test source was removed before the full suite. Calibration files
were never edited. `corpus-before.json`, `corpus-after.json`,
`corpus-comparison.log`, `check-corpus.py` and `corpus-probe.rs` retain the proof.

| Source | Files | Operations | Diagnostics before/after | Notes before/after |
| --- | ---: | ---: | ---: | ---: |
| `apps/chat/snapback` | 1 | 11 | 0 / 0 | 1 / 1 |
| Astra 0.3.0 | 8 | 41 | 11 / 11 | 6 / 6 |
| Astra 0.4.0 | 4 | 41 | 0 / 0 | 12 / 12 |
| Astra 0.4.1 | 5 | 51 | 0 / 0 | 8 / 8 |
| Astra 0.4.2 | 4 | 44 | 0 / 0 | 8 / 8 |
| Astra 0.4.3 | 3 | 45 | 0 / 0 | 14 / 14 |

The 0.3.0 failures are **baseline**, identical to the merged compiler:
`E_QUARRY_POSITIONAL_SCAN` in `chat.q` at 18:3, 45:13, 46:36, 47:36,
141:18, 147:18, 150:18, 251:18, 256:63 and 262:33, plus
`E_QUARRY_SHAPE_JOIN` in `social.q` at 122:10 (Row versus WriteRow).
Reproduce with the recorded corpus probe, or `snapback4 check` in that run's
`astra/source/` directory. These frozen programs were not repaired.
The Expo app has no independent Quarry schema; both apps' TypeScript checks
are part of the full suite below.

## Context, decisions and remaining limits

Used the adjacent `lane-lx/vendor/llp/skills/llp-orient/SKILL.md` because this
worktree's link remains uninitialized. Scoped context: LLP 3000 §4's fence;
LLP 2000.000 §6's static authorization/runtime meter boundary;
LLP 3000.007 §5.1–§5.2's list, assignment and pure-call semantics;
LLP 3000.019 §3.2's structural length census. These governing Snapback 4
records are in `llp/current/`; no new LLP or external hand-off was needed.

No assigned work was stopped or redesigned. For finding 6, implementation
moves the rewrite to assignment failures instead of narrowing the syntax walk:
this also preserves the real error when another array element genuinely names
the accumulator. The test includes `[xs + 1] + [xs]` for that boundary. All
requested valid recursive-growth rewrites remain. This is the only choice
beyond the reviewer's suggested implementation sketch, not a behavior deviation.

The prior optional-filter limitation is unchanged. With the shared
`profiles`/`members` fixture, a helper loop over
`members where .principal = p.principal and (amount = null or .unread = amount)`
inside a profiles job sweep still reports `E_QUARRY_BOUND` in both helper and
inline forms. Reproduce with:

```sh
cargo test -p snapback4-lang --test helper_placement unbounded_optional_domains_still_need_a_page_bound_in_both_forms
```

Keep the principal domain and move the optional predicate into an inner `if`
to retain full streaming totals. The original report gives the complete source.
No round-2 finding remains open.

## Full suite and wasm

Qualification is on implementation head **55e8c29af**, with no source edits
while the suite runs. Rust 1.97.0, Node 24.13.1, Bun 1.3.14; eight Cargo build
jobs, dev/test debug information disabled, incremental compilation disabled,
file-descriptor limit 65,536. Frozen Bun install passes. The lane runs only one
full suite. The existing 60-second suite budget is unchanged.

Ran `scripts/test.sh` **exactly once**, exit **1**, exact summary:

```text
== 1 failure(s) in 1393 s
   client tests
```

Rust: **3,876 passed, 0 failed, 24 ignored**, **891 s**, from 243 test binaries,
956 executions and workspace doctests. Client main: **2,631 passed, 2 failed,
10 skipped**, 2,643 reported tests; all seven additional shards pass **56/56**;
client phase **213 s**. All **78/78** client models pass, **259 s**. Fixture
wrappers **9/9**; native/wasm builds, docs budget, release guard, package
build/typecheck, chat schema check and both demo app typechecks pass. All
16 wasm/process provenance tests that failed in round 1 pass in this full run.
The inherited 60-second suite budget remains exceeded; none was raised.

Every full-suite failure is listed here:

| Test | Classification | Failure |
| --- | --- | --- |
| `closing the last journal owner during admission still invalidates another tab` (`packages/snapback4/test/react.test.mjs:135`, wait at `:146`) | **Baseline**, intermittent browser/client path | `page.waitForFunction: Timeout 30000ms exceeded`; another tab's pending-write hook did not contain the already admitted ID by the deadline. |
| `React hooks and reference-app lifetimes` (`packages/snapback4/test/react.test.mjs:17`) | **Baseline**, enclosing-test consequence | Its preceding nested test failed; no second independent defect was reported. |

**Ours: 0. Baseline: 2 reported test failures from one underlying timeout.
Environmental: 0 confirmed.** The fixture launches neither a backend nor Quarry:
it uses real online custody with controlled transport and browser localStorage.
All its client/app/test inputs and the imported receipts snippet are identical
to merged pre-fix `ccb09c02a`. No claimed root cause beyond that evidence.

After the full run, executed the unchanged React test file once in isolation:
**46/46 pass**, **3,496.960007 ms**; the formerly failing nested case passes in
**250.18955 ms**. `react-isolated.log` and `react-isolated.exit` retain the run.
No source, assertion or timeout was changed, and the full suite was not rerun.
This follow-up establishes intermittency, not a fix or a green full-suite claim.
The open baseline problem and reproduction are recorded in
[`issues/20260927-snapback4-react-journal-admission-invalidation-timeout.md`](../../../issues/20260927-snapback4-react-journal-admission-invalidation-timeout.md).
The suite log and exact exit are `target/lane-qe-r2/full-suite.log` and
`full-suite.exit`.

Wasm before and the full-run rebuild are byte-identical: **1,981,512 B raw /
572,053 B gzip**, delta **0 B / 0 B**, SHA-256
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
The unchanged **572,841 B** gzip budget leaves **788 B**. Core/device sources,
Cargo.lock and the wasm build script are unchanged from `ccb09c02a`; all
round-2 production changes are compiler/guide-only. Before/after measurement
records: `wasm-before.json`, `wasm-after.json`.

Final qualification is the passing **247 affected checks**, exact before/after
app/calibration comparison, full run with the one unrelated baseline timeout,
and the separately labelled isolated React pass. The final evidence commit
changes only this report, the journal and the baseline ticket. No assigned
finding remains open; no push or publication.
