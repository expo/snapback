# P2: extrema over scalar row expressions — 2026-09-26

Implementation lane: `sb4-intent/p2-extremum-expressions`, based on `0badac987`.
The supplied LLP 3000.019 §3.2 is the design authority. The supervisor owns
its document, integration and blind reviews. No push or package publication.

The implementation supports the requested receipt on the shared server/device
interpreter, preserves the original column-extremum encoding and seek, and
prices expressions as scans. **The wasm budget blocks landing**: the measured
artifact exceeds the unchanged ceiling. No budget or runtime meter was raised.

## Files

Paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/ir.rs` | Add `Builtin::ExtremumOf { value, max, domain }` beside the unchanged `Extremum`; expose all builtin operands and traverse nested read/scan sites. |
| `crates/snapback4-core/src/engine/extrema.rs` | Bind `$filter` for each authorized row, evaluate the projection, ignore nulls, retain the selected value under the heap meter, and share existing scalar coverage/cut handling. |
| `crates/snapback4-core/src/engine/read.rs` | Keep the source row's scratch allowance live while an expression evaluates; retain the existing transfer for literal fields. |
| `crates/snapback4-core/src/engine/runner.rs` | Dispatch expression extrema through the shared fold. |
| `crates/snapback4-core/src/engine/admission.rs` | Include projection operands in structural origin analysis. |
| `crates/snapback4-core/src/engine/page_collectors.rs` | Include projection dependencies in returned-page flow. |
| `crates/snapback4-core/src/engine/prefetch.rs` | Walk projection reads and mutations when planning prefetch. |
| `crates/snapback4-core/src/engine/presence.rs` | Include projection operands in presence dependencies and independence proofs. |
| `crates/snapback4-core/src/engine/read_only.rs` | Inspect projection blocks for effects. |
| `crates/snapback4-core/src/engine/write_target.rs` | Include projection purity when classifying write expressions. |
| `crates/snapback4-lang/src/bind/catalog.rs` | Hold original domain alternatives until typed overload resolution. |
| `crates/snapback4-lang/src/bind/intent.rs` | Plan and resolve domain alternatives only when optional-filter or lane rewriting changed the source. |
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | Select scan planning for scalar expression extrema without reordering binary collection comparisons; remember original unpaged sources. |
| `crates/snapback4-lang/src/bind/mod.rs` | Preserve source alternatives before optional-filter rewriting; include projections in merge discovery. |
| `crates/snapback4-lang/src/bind/program/extrema.rs` | Preserve column/binary overloads; bind scalar expressions, isolate per-row setup, infer optional result types, and refuse competing focal scope. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Refine nullable fields of the declared aggregate row under focal null guards. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Include projections in allocation discovery. |
| `crates/snapback4-lang/src/bind/program/returned_shapes.rs` | Include projection references in the returned-shape census. |
| `crates/snapback4-lang/src/bind/residency.rs` | Include reads inside projections in operation residency. |
| `crates/snapback4-lang/src/bind/residency/components.rs` | Include projections in component dependency analysis. |
| `crates/snapback4-lang/src/bind/residency/effect_reads/walk.rs` | Walk projection operands for effect-only slicing. |
| `crates/snapback4-lang/src/bind/residency/horizons.rs` | Include projection reads in horizon analysis. |
| `crates/snapback4-lang/src/bind/residency/presence.rs` | Include projections in presence-use validation. |
| `crates/snapback4-lang/src/guide/language.rs` | Show a conditional receipt value and document row scope, nulls, scans, caps and ambiguity. |
| `crates/snapback4-lang/src/guide/codes.rs` | Extend the existing ambiguity explanation; no new diagnostic code. |
| `crates/snapback4-lang/src/guide/why/E_TYPE.md` | Document scalar row-expression extrema and their rewrite. |
| `crates/snapback4-lang/tests/fixtures/guide-before.json` | Update the compiled-block hash for the deliberately revised receipt example. |
| `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json` | Update the pinned aggregate explanation to the expanded language text. |
| `crates/snapback4-lang/tests/fixtures/extremum-expressions.q` | Shared executable receipt, nullable, loop, page, list and nested-aggregate examples. |
| `crates/snapback4-lang/tests/extremum_expressions.rs` | Binder and server-engine regression coverage, listed below. |
| `crates/snapback4-device/tests/extremum_expressions.rs` | Run the same compiled programs on memory and SQLite devices, including coverage, prediction and reopen. |
| `crates/snapback4/src/scale.rs` | Price expression extrema as whole scans, with physical caps bounding residual rejects and per-row projection reads multiplied by the source bound. |
| `crates/snapback4/src/scale/dependencies.rs` | Include projection inputs in cost dependencies. |
| `crates/snapback4/tests/scale_extremum_expressions.rs` | Capped/uncapped classifications and nested-read cost proof. |
| `JOURNAL.md` | Append the dated implementation and measurement record. |
| `reports/20260926-p2-extremum-expressions.md` | This handoff and qualification record. |

## Forms that compile and run

The shared fixture uses `members` with `cap 50 by conversation` and a named
`m = { conversation, ordinal }`:

```quarry
min(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
max(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
```

Additional tested forms:

- Nullable arithmetic: `min(rows, .n + ordinal if .n != null else null)`.
- Defaulted projection: `max(rows, .n ?? 0)`.
- Text: `min([{ s: 'Z' }, { s: 'B' }], lower(.s))` returns `'b'`.
- Boolean: `max([{ n: 0 }, { n: 1 }], .n > 0)` returns `true`.
- Constant: `min([{ n: 8 }], 7)` returns `7`.
- Helper: `max([{ n: 8 }, { n: 2 }], bump(.n))` returns `9`, with `bump(n)` returning `n + 1`.
- Nested aggregates: `max(members where .conversation = conversation, (min([{ n: 7 }], .n + 1) ?? 0) + .seenOrdinal)`.
- Optional source filter: `max(t where (threshold = null or .n >= threshold), .n + 1)`.
- Enum complement and helper: `max(t where .kind != 'a', bump(.n))`.
- Existing literal column: `min(t, .n)` retains `Builtin::Extremum` and examines one row with an ordered index.
- Existing binary collection comparison: `max(rows, rows if true else rows)` preserves row order.

An empty or all-null projection returns null. An incomplete domain or a meter
cut is unavailable, including before `??`; it does not return a partial winner.
An expression such as `.n + 1` inside an enclosing shape that also provides
`.n` receives `E_QUARRY_AMBIGUOUS`, naming its site and a helper rewrite.

## Added tests and what they prove

`extremum_expressions.rs` in the language crate:

1. `row_expressions_match_a_loop_with_nulls_and_named_outer_values`: the exact receipt, max, explicit loop equivalence, null rows/values, page selection, named locals, nested row restoration, text/bool results and optional inferred type.
2. `expression_encoding_is_distinct_and_column_encoding_and_seek_survive`: old JSON encoding, round-trip IR, one examined row for a field seek versus all 40 for an expression.
3. `expression_cuts_never_become_a_partial_or_default_scalar`: examined, steps and heap exhaustion all withhold the scalar, including a defaulted result.
4. `authorization_precedes_the_value_expression`: a hidden zero divisor never evaluates; bounded pages fold only disclosed rows, and nonuniform domains preserve their unavailable contract.
5. `ambiguity_refusal_has_a_compiling_helper_rewrite`: competing enclosing scope refuses, its helper repair compiles, and independently scoped nested shapes remain valid.
6. `nested_read_sites_remain_visible_to_residency_and_ir_walks`: a point read inside the projection appears in read-site and residency facts.
7. `binary_collection_expressions_keep_the_original_order`: conditional collection operands keep both binary overloads' original ordering.
8. `constants_helpers_all_nulls_and_empty_sources`: constant/helper projections and null identities.
9. `optional_filters_and_inferred_lanes_remain_whole_domains`: absent/present optional input and enum complement retain metered scans, not materialized lanes; cuts withhold the result.

The two device tests run on memory and SQLite. They compare server answers with
fully acquired device answers, withhold horizon-limited and online-only sources,
check prediction eligibility and predicted rows, and repeat after reopen.

The two certificate tests prove constant capped scans versus growing uncapped
scans, and seven priced examinations for a cap-three source with one point read
per row (four scan candidates plus three projections).

## Decisions and deviations

- The device links the core interpreter; no second engine implementation exists to edit.
- Per-row setup uses the existing `Expr::Block`; it runs inside the fold. Projection/helper allocations stay charged cumulatively, as in the existing streaming sum. The winner retains its separate heap charge.
- A typed scalar result may require recovering the original unpaged read after optional/lane planning. This compiler-only alternative preserves binary page semantics and prevents an inferred page from becoming a partial domain aggregate.
- Physical cap reasoning deliberately excludes expiring sources and maintained group tables. Expiry backlog and implicit aggregate reads retain their existing growth explanations.
- The receipt example and its two text/hash pins intentionally changed. Existing behavior tests were retained.
- LLP 3000.019 was supplied in the task and is absent from this checkout; the supervisor owns landing it. New references use the requested `@ref LLP 3000.019#3.2`.
- The wasm ceiling was not raised. The feature's measured artifact is over budget, so this lane does not claim release qualification.

## Measurements and open problems

Rust 1.97.0, wasm-bindgen 0.2.127, Linux x86_64, no wasm-opt,
`CARGO_INCREMENTAL=0`, `scripts/build-wasm.sh` on this host:

| Artifact | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| Untouched lane base | 2,009,169 | 577,903 |
| P2 implementation | 2,023,872 | 582,597 |
| Delta | +14,703 | +4,694 |

The fixed ceiling is **578,207 bytes gzip**. **P2 exceeds it by 4,390 bytes**;
the base passed with 304 bytes headroom. This is a whole-artifact comparison,
not per-component byte attribution. Later planner changes are language/compiler
only and do not enter the web artifact.

Reproduce the blocking problem from `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 bash scripts/build-wasm.sh
```

No authorization, disclosure, durability or runtime meter was weakened to make
the feature fit. Budget disposition belongs to integration under the user's
fixed-budget instruction; this lane did not change the ratchet.

## Qualification

Final affected validation after the planner follow-up: **186 passed, zero
failed**, including the full guide target (84), both device-store cases,
old extrema and the new source-planning regression. A separate temporary
Node smoke (`/tmp/lane-p2-wasm-smoke.mjs`) passed direct server/compiled-wasm
comparisons for receipt, fastest, nullable, defaulted and nested queries. The 18 existing scale
tests also passed in the earlier affected run. Package build and typecheck
passed inside the full suite. `git diff --check` passes; the largest changed
Rust file is 1,410 lines.

The full client phase passed **1,997 tests**, with **zero failures and 10
skips**. The skips are the existing macOS media test on Linux and nine cases
requiring separately supplied legacy/pinned binaries or identity fixtures;
this lane added no skip or waiver.

The complete suite began at `c8f1eaac9`; the compiler-only follow-up
`8d353ceee` received the separate final affected run above. No second complete
battery was run for that compiler refinement. The shared runtime and measured
wasm were unchanged by it.

Full-suite command (from `snapback4/`):

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
env -u FORCE_COLOR CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 \
  CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 \
  SNAPBACK4_RUST_TEST_PROCESSES=4 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 \
  bash scripts/test.sh
```

Exact `scripts/test.sh` result (exit 1):

```text
== 2 failure(s) in 2921 s
   wasm build
   cargo test
```

All **78 seeded-model checks passed**, including the two 5,000-sequence
session models and the 3,000-interleaving online-client model. The only
individual Rust test failure was the timing case listed below. No baseline
content failure was identified.

Failures:

- **Ours — wasm build:** 582,597 B gzip exceeds 578,207 B by 4,390 B.
- **Environmental timing variance — Rust `snapback4-lang::clique_03::application_fixture`:**
  `tests/clique_03/measure.rs:38` measured reader ratios
  `1.0528987105961412, 3.5417372088989985`; the limit is 3. Correctness and
  meter assertions passed. An isolated retry passed without changing the
  test, source, limits or sample counts (retry ratios: dense/sparse
  1.0175986729207183, celebrity/sparse 0.9728921176066812). Reproduce with
  `cargo test -p snapback4-lang --test clique_03 application_fixture -- --nocapture`.

The suite's original failure remains recorded despite the isolated pass.
Local logs: `/tmp/lane-p2-suite.log`, `/tmp/lane-p2-final-affected.log`,
`/tmp/lane-p2-clique-retry.log`, `/tmp/lane-p2-wasm-base.log` and
`/tmp/lane-p2-wasm.log` and `/tmp/lane-p2-wasm-smoke.log`.

## Round 1 — 2026-09-26

This section supersedes round 0's IR layout, wasm blocker, and qualification.
Read both blind reviews in full and accepted every finding. No finding was
rejected. The user authorized the non-recursive IR layout as an amendment to
LLP 3000.019 §3.2; the merged main now contains that supervisor-owned RFC.

### Integration and constraints

Fetched origin and merged the specifically requested `99153132b`, even though
`origin/main` had advanced to `ffe420f77`. Merge commit: `7fec1c171`.
Only `JOURNAL.md` conflicted; both complete append histories were preserved.
The merged code retains main's live presence, receipts card, backlog class and
ephemeral tables. Before changing implementation code, rebuilt and passed
**118 tests**: language extrema 9, guide 85, device extrema 2, scale 20 and
expression scale 2. Log: `/tmp/lane-p2-r1-merged-tests.log`.

Scoped `llp-orient` context: LLP 3000 §4 (the independent Snapback 4 fence),
LLP 3000.013 §5.1 and §14.4 (streaming coverage/meters and backlog classes),
LLP 3000.001's component eligibility and coverage frames, and LLP 3000.019
§3.2 (expression extrema). The language card remains the current authoring
surface. Runtime authorization/disclosure, scalar completeness, the old field
encoding/seek, and the fixed wasm ratchet remain constraints. No new design
LLP or approval was needed; the user explicitly authorized this round.

### Review dispositions

| Finding | Change and evidence |
| --- | --- |
| Astra 1: projection cuts become application errors | Shared `aggregate_projection` binds/restores `$filter`, then calls `require_uncapped()` before propagating the expression result. The exact division-by-zero cut reproduced before the fix. Both min/max now withhold at the nested-read boundary, including after an earlier winner and before a default. An ordinary missing divisor with no cut still reports `E_DIV_ZERO`. |
| Astra 2: lost independent components | Analyze the source in its existing scope and the projection with a temporary local `$filter`; restore all prior locals. Apply the same scope handling to streaming sum and scan predicates. External reads/names still count. Binder tests cover named inputs, nested aggregates and escaped bindings; memory and SQLite tests compare column/expression coverage after reopen, preserving the complete local field beside an unknown remote field. |
| Astra 3: hidden rows defeat physical caps | Pass the physical candidate bound into scan pricing, including authorization rejects and residual filters, while preserving complete-rule probe accounting. A global cap 3 prices four candidate examinations and, with a per-row existence rule, eight reserved/evaluated probe units. Runtime nonuniform-domain refusal is unchanged. Expiry, maintained work and word-prefix fanout do not gain an unsound physical-row bound. |
| Astra 4 / Grok wasm finding | `ExtremumOf { max, domain }` stores the projection in `args[1]`; remove `operands()` and restore the original argument walkers. Share projection evaluation with totals and dispatch with column extrema. The unchanged ratchet now passes. |
| Grok non-domain pricing | A compiler-side census recovers immutable page/list lengths and aliases, literal lengths and list-argument maxima. Projection reads use that count multiplied by enclosing iterations. Reassigned/pushed lists fail closed to a conservative meter allowance. Tests price the actual page/list fixtures with added point-read projections, plus direct pages, direct arrays and a bounded list-argument alias. |
| Both reviewers' surviving mutations | All named mutants are killed by assertions: skipping null rows, dropping `times`, and zeroing non-domain projection cost. A fourth mutant restores the old step-ceiling price; both the page and list tests fail. Sources were restored and the affected tests passed afterward. |

### Round-1 file changes

All paths below are relative to `snapback4/`.

- `crates/snapback4-core/src/ir.rs`: non-recursive new builtin, arity two,
  ordinary read/scan walks; old `Extremum` serialization unchanged.
- `crates/snapback4-core/src/engine/extrema.rs`: shared row binding,
  restoration, evaluation and projection-cut precedence for totals/extrema.
- `crates/snapback4-core/src/engine/runner.rs`: shared field/expression
  dispatch and operand-count validation.
- `crates/snapback4-lang/src/bind/program/extrema.rs`: emit projection in
  `args[1]`.
- `crates/snapback4-lang/src/bind/residency/components.rs`: scoped row
  analysis for projections and predicates without erasing outside dependencies.
- `crates/snapback4/src/scale.rs`: physical candidate cap passed through
  scan pricing; non-domain projection counts and enclosing multipliers.
- `crates/snapback4/src/scale/collections.rs`: compiler-only immutable
  collection-bound recovery, rejecting reassigned and pushed definitions.
- `crates/snapback4-lang/tests/extremum_expressions.rs`: projection-cut
  boundary and null-source-row regressions.
- `crates/snapback4-lang/tests/components.rs`: row-scope, nested-expression,
  external-dependency and escaped-binding proof tests.
- `crates/snapback4-device/tests/extremum_expressions.rs`: independent
  field coverage on both stores after reopen.
- `crates/snapback4/tests/scale_extremum_expressions.rs`: physical cap/rule
  probes, enclosing iterations, page fixture and list fixture tests.
- Restored ordinary argument traversal in core `engine/admission.rs`,
  `engine/page_collectors.rs`, `engine/prefetch.rs`, `engine/presence.rs`,
  `engine/read_only.rs`, `engine/write_target.rs`; language `bind/mod.rs`,
  `bind/program/expr.rs`, `bind/program/returned_shapes.rs`, `bind/residency.rs`,
  `bind/residency/effect_reads/walk.rs`, `bind/residency/horizons.rs`,
  `bind/residency/presence.rs`; and `scale/dependencies.rs`. Most are now
  byte-identical to main; the necessary new-builtin match arms remain.
- `crates/snapback4-lang/tests/extremum_expressions/schema.q`: move the P2
  fixture unchanged from `tests/fixtures/extremum-expressions.q`, outside the
  frozen durable compatibility corpus; update the three test targets' includes.
- `JOURNAL.md`: one appended round-1 entry. This report: this round-1 section.

### Forms and regression evidence

All round-0 forms remain supported. The amended encoding changes no Quarry
spelling. Representative forms covered by the tests:

```quarry
min(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
max(members where .conversation = m.conversation and .joinedOrdinal < m.ordinal, 2 if .seenOrdinal >= m.ordinal else 1)
min(t, .n)                         -- the original column seek
min(t, .n + 0)                     -- expression scan
max(rows, .n ?? 0)                 -- null source rows are evaluated
max(t, 10 / (details[.target].n ?? 0)) -- a cut withholds, not E_DIV_ZERO
```

Nine new round-1 tests (the scale fixture cases are separate tests):

1. `projection_read_cuts_withhold_even_after_a_previous_winner`: both
   extrema, one/two rows, complete controls, cut before default, true error control.
2. `null_source_rows_still_evaluate_the_projection`: a null source row supplies
   the winning max/min fallback, so skipping it fails.
3. `expression_extrema_scope_rows_but_keep_external_dependencies`: column,
   expression and sum plans; nested row-scope restoration; external names/reads;
   no `$filter` escape into a sibling field.
4. `expression_extrema_memory_independent_components`: fully synced local
   aggregate stays complete while the online sibling remains unknown, after reopen.
5. `expression_extrema_sqlite_independent_components`: the same on SQLite.
6. `physical_caps_bound_hidden_candidates_and_keep_rule_probes`: a physical
   cap includes hidden/residual-rejected candidates and retains rule probe cost.
7. `enclosing_iterations_multiply_projection_reads`: four iterations cost
   28 examinations, not the mutant's 19.
8. `page_fixtures_price_every_projection_at_the_source_bound`: two selected
   rows plus scan lookahead cost five examinations, for a bound page and direct page.
9. `list_fixtures_price_every_projection_at_the_source_bound`: two projections
   over four fixture items cost eight reads; list-argument alias costs four;
   direct two-item literal costs two.

Before the final suite, the affected targets passed **165 tests** across the
successful runs (including 85 guide tests and all 20 existing scale tests).
The last restoration run passed all 11 expression and six certificate tests.
The earlier combined affected run had 164 tests before splitting the page/list
assertions into separate tests. No existing assertion was weakened.

Mutation evidence: `/tmp/lane-p2-r1-mutations.log` and
`/tmp/lane-p2-r1-mutant-{null-row,times,non-domain-zero,non-domain-steps}.log`.
Each mutation exited 101 with an assertion failure, not a build failure.
The zero and step-ceiling mutants each failed both page and list tests.

### Wasm

Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt; measured from the merged tree:

```sh
CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 bash scripts/build-wasm.sh
```

| Artifact | Raw B | gzip B |
| --- | ---: | ---: |
| Main `99153132b`, supplied integration measurement | 2,021,689 | 581,094 |
| Round 0 merged onto that main | 2,036,400 | 585,695 |
| Non-recursive operands and shared projection evaluation | 2,024,772 | 582,640 |
| Shared column/expression dispatch | 2,024,170 | 581,930 |
| Final visitor cleanup, full-suite rebuild | 2,024,130 | 581,998 |

The final runtime is **+2,441 B raw / +904 B gzip versus main**, and **3,697 B
gzip smaller than the merged round-0 implementation**. The unchanged
**582,094 B** ratchet has **96 B headroom**; **zero bytes remain over**.
Forcing the shared evaluator out of line measured identically and was removed.
These are whole-artifact measurements, not independent symbol attribution.
Logs: `/tmp/lane-p2-r1-{merged,compact,shared,dispatch}-wasm.log`.

### Final qualification

Implementation checkpoint: `6e410ecc5f6fa02abfed2e3fff0e2f94f4da8213`.
The round ran `scripts/test.sh` exactly once on the final runtime implementation,
with source fixed throughout. The test-only fixture relocation below followed it. Bun's frozen install succeeded without dependency
changes. Node 24.13.1, Bun 1.3.14, Linux x86_64.

```sh
env -u FORCE_COLOR CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 \
  CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 \
  SNAPBACK4_RUST_TEST_PROCESSES=4 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 \
  bash scripts/test.sh
```

Exact `scripts/test.sh` result, **exit 1**:

```text
== 1 failure(s) in 3263 s
   cargo test
```

Every full-suite failure:

- **Ours, fixed after the suite:**
  `snapback4-lang::ephemeral_compat::durable_schema_and_types_keep_base_bytes`
  failed its fixture-key comparison because P2 added `extremum-expressions.q`
  to the flat, frozen `tests/fixtures` directory. The same source was moved
  byte-for-byte into `tests/extremum_expressions/schema.q`, and the language,
  device and certificate tests' includes updated. The existing compatibility
  test and both frozen byte snapshots are unchanged. An affected follow-up
  passed **22 tests**: compatibility 1, language extrema 11, device extrema 4,
  certificate extrema 6. The original full-suite failure remains recorded;
  no second full run was made. Runtime/binder/certificate implementation and
  measured wasm did not change after the suite.
- **Baseline failures: none. Environmental failures: none.** The round-0
  `clique_03` timing target passed all three tests in this run.

Full run: **3,592 Rust tests passed, one failed, 19 existing ignores** across
227 binaries / 939 executions plus doctests; fixture wrappers **9/9**;
ordinary clients **2,179 passed, zero failed, 10 existing skips**; seeded
models **78/78**, including both 5,000-sequence session models and the
3,000-interleaving online model. The skips are the macOS media case and nine
optional legacy-binary/identity-fixture cases; no new skip or waiver.
Workspace/wasm/package builds, all typechecks, docs budget and release guard
passed. The suite's wasm rebuild is the final measurement above.

The direct compiled-wasm smoke passed all five server/device comparisons.
Logs: `/tmp/lane-p2-r1-suite.log`, `/tmp/lane-p2-r1-fixture-fix.log`,
`/tmp/lane-p2-r1-wasm-smoke.log`. The relocated fixture's SHA-256 is
`055ac2d7185139e7468f74b26d336c646ab4d5b607b2d55ade64b33173058f16`,
identical before and after the move. No review finding remains open. The
qualification limitation is explicit: the single complete run recorded the
fixture-list failure, and its repair received affected verification only.

The user-authorized IR amendment is the only design deviation: new projections
live in `args[1]`, not recursively inside `Builtin`. Old column encodings and
one-row seeks stay intact. No budget or runtime ceiling was raised; no
publication, push, authorization/disclosure relaxation, or second interpreter.
The largest changed source file remains 1,410 lines. `git diff --check` passes.
