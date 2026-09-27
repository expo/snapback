# Lane QE — round 3, 0.4.5 / 0.4.6

2026-09-27. Branch `sb4-intent/qe-quarry-ergonomics`. Read the binding lane
prompt, all three earlier reports and their journal entries, and both complete
round-2 reviews. Fetched and merged `origin/main` **10f69a744** as
**d3d891a9c** before editing. The merge had no conflicts and retains both sides.
Every round-3 commit, including the merge, has the requested Astra co-author.
No push or publication.

All four assigned findings are addressed. The production changes are confined
to the language crate. No test outside that crate changed, so the final-round
instruction supersedes the original prompt's full-suite requirement.

## Changes, file by file

Paths are relative to `snapback4/` except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/types.rs` | Join enum pairs to their variant union. Retain an existing superset's order, otherwise deduplicate in encounter order. Carry the enum-conflict marker through nested join paths. |
| `crates/snapback4-lang/src/bind/program/joins.rs` | Enum item refusals explain the value-preserving typed identity helper, including all variants and applying it to each conflicting field. The advice is conditional on the values belonging to that enum. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Check both append item types against their common type, admitting disjoint enum unions. Recursive guidance follows container values and conditional arms rather than names inside scalar consumers such as `count(xs)` or `count([xs])`. |
| `crates/snapback4-lang/tests/list_widening.rs` | Two regressions: enum-pair compilation/execution and the diagnostic's typed-helper repair. Assert enum result types, bounded literal/concat lengths, retained Push lowering, and exact runtime values. |
| `crates/snapback4-lang/tests/list_expressions.rs` | One regression: eight scalar-consuming append/prepend cases keep one located item-join error; the corresponding integer accumulator executes correctly. |
| `crates/snapback4-lang/tests/pure_call_narrowing.rs` | Three independent regressions: ordered call arguments, transitive table counts, and a helper's page loop. Each kills its specified purity/identity mutant. Production purity code is unchanged. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Update §5.1 and its revision history for enum unions, the identity repair, and the scalar-consumer diagnostic boundary. §5.2 already specifies ordered arguments and table-read impurity. |
| `JOURNAL.md` | One dated append, preserving all previous entries. |
| `reports/20260927-qe-quarry-ergonomics/ROUND3.md` | This qualification report. |

No engine, authorization, disclosure, durability, IR-format, meter, version,
dependency, guide inventory or budget change. All changed source files remain
under 1,500 lines; the largest is `control.rs`, 709 lines. No diagnostic code
was added. The complete guide runs without changing a card or its budget.

## Compiling and running forms

For `a: enum('on')`, `b: enum('on', 'off')`, and runtime arguments `on` / `off`:

| Form | Example | Result |
| --- | --- | --- |
| Literal | `return [a, b]` | `['on', 'off']`, item type the two-variant enum, length bound 2 |
| Concatenation | `return [a] + [b]` | Same values and type, length bound 2 |
| Self-append | `xs = [a]`, then `xs = xs + [b]` in `for i in [1]` | Same values and enum item type; retains Push and the existing heap-bound list |
| Typed repair | `fn state(v: enum('on', 'off')): v`, then `[state(a), state(b)]` | Both strings unchanged |
| Scalar-consuming append | Start `xs = [0]`, then append `[count(xs)]` twice | `[0, 1, 2]` |

The enum regression runs both operand orders through all three list forms for
subsets, equal sets in different orders, disjoint sets, overlapping sets, and
variants outside the text character domain. An optional enum in a nested record
also joins to the optional union. Quarry imposes no variant-count limit, so
valid enum pairs need no new refusal boundary. Enum/text still respects its
existing character-domain restriction; the identity-repair test uses that
remaining refusal and runs the full declared-enum helper without changing values.

Starting instead with `xs = ['a']`, `xs = xs + [count(xs)]` now reports one
`E_QUARRY_TYPE` at line 4: `cannot join list items at field path []: text <=1 and int`.
The equivalent prepend reports `int and text <=1`. Neither reports recursive
growth. Direct, conditional and mutually recursive accumulator tests still
require the fixed-item self-append guidance.

These remain refused with the existing present-number error and bind-once rewrite:

- `f(1, 2) + 1 if f(2, 1) != null else null`, where
  `fn f(a: int, b: int): 1 if a > b else null`.
- The review's `countNotes(): count(notes)` / optional `f()` program that deletes
  a note between the guard and the second call.
- A helper that sets `found = 1` only inside `for row in notes first 1`, returning
  `1 if found > 0 else null`, with that same guarded deletion and second call.

## Tests and mutation evidence

Ignored, reproducible evidence is under `target/lane-qe-r3/`.

| Evidence | Result |
| --- | --- |
| `regressions-before.log` | All three new implementation regressions fail on merged round-2 production code: enum pairs refuse, the enum repair is absent, and scalar-consuming append gets recursive guidance. The existing tests and three new narrowing controls pass. |
| `regressions-after.log`, `affected-compiler.log` | All six new tests pass with the fixes; the final affected run also includes the strengthened exact enum-result and nested-optional assertions. |
| `purity-argument-order-mutation.log` | Sorting only `Stable::Call` argument keys makes the argument-order regression fail: the unsafe program compiles with no diagnostics. |
| `purity-scan-mutation.log` | Changing only `Expr::Scan(_)` to pure makes the transitive `count(notes)` regression fail for the same reason. |
| `purity-page-mutation.log` | Changing only `LoopDomain::Page(_)` to pure makes the page-loop regression fail for the same reason. |
| `check-purity-mutants.py`, `purity-mutations.log` | Repeat all three exact mutations independently, require a test failure rather than a build error, and restore source byte-for-byte in a finally block. No mutation remains. |
| `affected-compiler.log` | **171/171 pass**: guide 86, control flow 1, frozen compatibility 1, historical ergonomics 22, helper placement 8, joined shapes 17, list expressions 14, reference repairs 3, widenings 8, pure-call narrowing 11. |
| `docs-budget.log` | README 300/300 lines; the named first-account guide test passes. |
| `bun-install.log`, `chat-typecheck.log`, `expo-typecheck.log` | Frozen install makes no changes; both demo TypeScript checks pass. |
| `ref-check.log` | 517 LLP documents, 9,617 references, zero errors or unchecked references. |

The three mutants each compile and fail their target test (exit 101, one failed
test, no diagnostic on the unsafe Quarry source). Restoring the source makes
all eleven narrowing tests pass. No production narrowing fix was needed.
A first mutation-driver assertion incorrectly expected a filename in the panic
text; the log already showed the desired empty diagnostic list. Corrected only
that ignored driver assertion, then ran all three controls successfully.

## Demo and calibration compatibility

`check-corpus.py` compiles every Quarry source under `apps/` and
`benchmarks/runs/*/astra/source/`, grouped by source directory. It temporarily
substitutes the three changed production files from merged baseline
`d3d891a9c`, builds and records results, restores the final files, rebuilds and
compares. All **31 source files** have exactly identical operation names,
diagnostics (code, site, message, rewrite) and notes before and after.
The temporary probe was removed; app and calibration files were not edited.

| Source | Files | Operations | Diagnostics | Notes |
| --- | ---: | ---: | ---: | ---: |
| Chat | 1 | 11 | 0 | 1 |
| Astra 0.3.0 | 8 | 41 | 11 | 6 |
| Astra 0.4.0 | 4 | 41 | 0 | 12 |
| Astra 0.4.1 | 5 | 51 | 0 | 8 |
| Astra 0.4.2 | 4 | 44 | 0 | 8 |
| Astra 0.4.3 | 3 | 45 | 0 | 14 |
| Astra 0.4.4, added by this merge | 6 | 52 | 0 | 10 |

Astra 0.3.0's unchanged failures are ten `E_QUARRY_POSITIONAL_SCAN` sites in
`chat.q` (18:3, 45:13, 46:36, 47:36, 141:18, 147:18, 150:18, 251:18, 256:63,
262:33) and `E_QUARRY_SHAPE_JOIN` at `social.q:122:10` (Row versus WriteRow).
Run `python3 target/lane-qe-r3/check-corpus.py` from `snapback4/`, or compile
that 0.3.0 calibration's eight module files together, to reproduce.
The Expo demo has no independent Quarry schema; its TypeScript check passes.

## Scope, remaining limits and full-suite record

Used the adjacent `lane-lx/vendor/llp/skills/llp-orient/SKILL.md` because this
worktree's skill link remains uninitialized. Governing context is
LLP 3000 §4's fence, LLP 2000.000 §6's authorization/meter boundary, and
LLP 3000.007 §5.1–§5.2's list and pure-call semantics, all in `llp/current/`.
The existing LLP records the changes; no new design, hand-off or approval was
needed. There is no deviation from the four assignments and none remains open.
Implementation choices: keep enum ordering where possible, use the admitted
variant union for disjoint sets, and retain the text-domain restriction rather
than coercing strings. The enum repair is advice for values belonging to a
common enum, not a conversion of arbitrary incompatible values.

Unchanged limits outside the four assignments:

1. Optional-filter streaming still needs the documented workaround. With the
   shared profiles/members fixture, use
   `members where .principal = p.principal and (amount = null or .unread = amount)`
   inside a helper called from a recipient sweep: helper and inline forms both
   report `E_QUARRY_BOUND`. Reproduce with
   `cargo test -p snapback4-lang --test helper_placement unbounded_optional_domains_still_need_a_page_bound_in_both_forms`.
   Move the optional predicate into an inner `if` to keep streaming totals.
2. Grok's separate principal/reference observation was not among the round-3
   assignments. `table users: public` plus
   `query run(p: principal, u: users): [p, u]` (using ordinary multiline table
   syntax) still refuses its item join. `fn exposedId(value: id): value` and
   `[exposedId(p), exposedId(u)]` express the intentional common ID type.
3. The round-2 full suite's client timeout remains an unrelated baseline issue,
   recorded in `issues/20260927-snapback4-react-journal-admission-invalidation-timeout.md`.
   Reproduce the intermittent case through `scripts/test.sh`; the isolated
   `node --test packages/snapback4/test/react.test.mjs` passed 46/46 in round 2.

**Round 3 did not run `scripts/test.sh`, as authorized by the final-round
instruction for compiler-local changes. No test outside the language crate
changed.** The latest full-suite result remains round 2's historical run at
`55e8c29af`, exit 1, exactly:

```text
== 1 failure(s) in 1393 s
   client tests
```

Its complete failure list was `closing the last journal owner during admission
still invalidates another tab` (`react.test.mjs:135`, wait at :146), plus its
enclosing `React hooks and reference-app lifetimes` test. Both are **baseline**
reported failures from one 30-second `page.waitForFunction` timeout. Round 2 had
zero lane-owned or confirmed environmental failures; Rust passed 3,876 tests,
with 24 ignored. These are historical results, not a round-3 full-suite claim.
Round 3's affected checks have **zero failures**.

Rebuilt the production web wasm: **1,981,512 B raw / 572,053 B gzip**, identical
to the pre-round artifact, **delta 0 / 0 B**; SHA-256
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
The unchanged **572,841 B** cap leaves **788 B**. Core/device production sources,
Cargo.lock and the wasm build script are unchanged; the device's language
crate dependency is test-only. Evidence: `wasm-build.log`, `wasm-before.json`,
`wasm-after.json`. Rust 1.97.0, Node 24.13.1, Bun 1.3.14; affected compiler and
mutation runs use eight Cargo jobs, dev/test debug info and incremental off.
