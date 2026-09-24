# LLP 3000.013 lane D — Astra review round 1

All five findings are addressed on `sb4-intent/d-work`. This report supplements
`20260924-intent-work.md`; it does not replace that implementation record.
The four behavioral regressions reproduced before their fixes. The permanent
key write-meter regression also fails when its charge is deliberately removed.
That temporary mutation was restored before final verification.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Review correction |
|---|---|
| `crates/snapback4-core/src/engine/components.rs` | Observe coverage in an optional scalar frame, independently of the enclosing component/page. Query-wide flags and component observations remain monotone. |
| `crates/snapback4-core/src/engine/read.rs` | Scope scalar availability to its own reads, restoring the enclosing scalar observation even on errors. Adaptive pages fetch only remaining selected slots and stop at K without lookahead. |
| `crates/snapback4-lang/src/bind/program/prefix.rs` | Consider a fitting schema cap before selecting a query aggregate's meter bound. |
| `crates/snapback4-lang/src/bind/program.rs` | Uniformly decided aggregates still stream; schema-capped, non-uniform queries retain the existing literal bound. Uncapped non-uniform admission remains refused. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Lower a schema-capped non-uniform sum through the existing bounded projection loop. Bind the source exactly once. |
| `crates/snapback4-lang/src/parser/programs.rs` | Recognize automatic read sweeps only when no explicit page clause is present. Paged prelude loops stay in the prelude. |
| `crates/snapback4-lang/src/guide/bounds.rs` | State the compatibility contract for schema-capped non-uniform aggregate queries. |
| `crates/snapback4-lang/src/guide/jobs.rs` | Clarify that explicitly paged prelude loops do not establish chunk commits. |
| `crates/snapback4-sim/tests/work_intent_review.rs` | Five regression tests described below. |
| `JOURNAL.md` | Append this round's dated verification record. |
| `reports/20260924-intent-work-r1.md` | This report. |

## Executable regressions and restored forms

`cargo test -p snapback4-sim --test work_intent_review -- --nocapture` runs:

1. `resolved_inner_aggregates_preserve_the_non_uniform_outer_page`: owner-only
   folders with public indexed notes. The returned page retains Alice's one
   folder, excludes Bob's folder, remains incomplete and carries a continuation.
   Tests all three predicates: `exists notes[.id] by byFolder`,
   `count(notes[.id] by byFolder) > 0` and
   `sum(notes[.id] by byFolder, .n) > 0`.
2. `adaptive_single_item_chunks_do_not_fetch_a_second_large_row`: two rows with
   1,500,000-character bodies complete `for item in items: emit notify ...`
   in two committed chunks, K=1 after six retries, with exactly one effect for
   each item. Refused attempts enqueue nothing. The reported peak is
   **21,011,158 B**, including the refused larger attempts; it is not the heap
   of a successful K=1 chunk. The runtime ceiling remains **16,777,216 B**.
3. `schema_capped_non_uniform_count_and_sum_keep_their_execution_path`:
   `count(items[] by byId)` and `sum(items[] by byId, .n)` compile and execute
   with `cap 100` and `read <- .owner = viewer`. Alice sees 2/18, Bob 1/1000,
   Carol 0/0, all retaining the existing non-uniform coverage contract.
4. `explicitly_paged_job_prelude_loop_remains_a_prelude`: a paged `for row in
   items first 10 by byId` computes a prelude total of 5; the following fixed
   `chunk` writes 5 to both rows, at K=10 with zero retries.
5. `permanent_effect_keys_consume_the_write_meter_and_rollback_with_effects`:
   `emit notify { i } once [i]` for 1,024 distinct keys commits 1,024 keys and
   effects. For 1,025 keys it refuses with `E_BOUND` and commits zero keys and
   zero effects. Temporarily removing `RowsWritten` made this test fail with
   a successful mutation and zero charged writes, proving the assertion
   protects the charge the reviewer identified.

No new syntax or refusal code was introduced. No authorization, expiry,
coverage admission, runtime ceiling, stable-index restriction, or transaction
boundary was relaxed. The coverage implementation uses existing observations
instead of clearing shared flags. Successful nested scalars cannot contribute
an incomplete observation; unavailable nested scalars unwind their parents.

## Verification

The new five tests and all twelve existing work-intent tests pass. The scheduled
scale fixture still emits exactly 50 digests in 26 chunks, K=2 after five
retries, with **13,188,641 B** peak heap. The recipient-heavy digest version
still peaks at **4,104,585 B**. The varying-cost first chunk now peaks at
**128,645 B** after removing lookahead (previously 137,081 B).

All **156 affected tests** pass: 5 review regressions, 12 work-intent tests,
40 frontend regressions, 55 guide tests, 10 language prefix tests, 7 device
component tests, 14 device prefix tests, 12 server prefix tests and the
retained-fixture test with its ten historical controls. The original retained
5,000-candidate / 4,900-hit / 50-recipient fixture still peaks at
**4,102,784 B**, below the unchanged 16 MiB ceiling, in one job chunk.
Its cumulative Rust allocation counter remains 48,089,110 B (allocation churn,
not live heap or RSS).

`ref-check --verbose`: **504 LLP docs, 9,211 refs in 25,445 files, 0 errors,
0 unchecked**. `git diff --check` passes. The largest changed source remains
below 1,500 lines. WASM measures **1,713,043 B raw / 475,320 B gzip**, +968 raw
/ +319 gzip from the preceding lane commit, within the unchanged 476,000 B
budget with 680 B headroom.

The full `scripts/test.sh` run exits 1 with exactly:

```text
== 1 failure(s) in 187 s
   cargo test
```

Log: `/tmp/lane-d-r1-full-test.log`. Every failure is **baseline**, present
in `~/sb4-intent/baseline-test.log` and `BASELINE-FAILURES.md`:

| Failing test | Reproduction from `snapback4/` |
|---|---|
| `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The census mismatch is set-equal to the baseline: 12 actual-only entries and
1 expected-only entry. No new suite failure or environmental failure remains.
All other suite stages pass, including the guide, CLI telemetry, Rust review
regressions, client tests, builds, typechecks and WASM budget. These four
inherited failures are the only open problems observed in this verification;
they are outside this review's fixes.

## Scope

No deviations from the five review requests. There is no runtime implementation
change for finding 5: the existing charge is correct and now has a boundary and
rollback regression. No pushes or publication. Grok's separate review is not
part of the findings received for this round.
