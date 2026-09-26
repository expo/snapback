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
