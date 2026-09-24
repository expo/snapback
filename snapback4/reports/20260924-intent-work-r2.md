# LLP 3000.013 lane D — Grok review round 2

All four findings are addressed on `sb4-intent/d-work`. This supplements the
original implementation and Astra round 1 reports. No admission or runtime
ceiling changes, no new syntax/IR/diagnostic, no push or publication.

## Findings and implementation, file by file

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Release key decode and key-copy scratch with each streamed row. Reserve the one retained cursor/key separately from transient scratch; enlarge that reservation only when a larger key is encountered, before decoding/cloning it. Add a prepaid domain collector that fetches one row at a time and charges the selected image and result buffers before retention. Adaptive job pages also fetch exactly one candidate at a time, regardless of rule uniformity, and prepay key decoding/copying. |
| `crates/snapback4-core/src/engine/runner.rs` | Route plain `Bound::Meter` domains in aborting programs through the prepaid collector. Avoid the old post-materialization charge for that path because retention is now paid before each push. Explicit pages and word consumers retain their existing execution paths. |
| `crates/snapback4-core/src/meter.rs` | Describe the exact scratch release and separate retained allowances. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Document transient key scratch, the retained cursor and prepaid inner job domains. |
| `crates/snapback4-sim/tests/digest_count.rs` | Tighten the original retained fixture's peak assertion to 370,500 B; doubling key scratch now fails. |
| `crates/snapback4-sim/tests/work_intent.rs` | Tighten the ordinal/deduplicated digest fixture to 373,000 B. |
| `crates/snapback4-sim/tests/work_intent_review2.rs` | Four tests covering wide-key streaming, inner-domain decode ordering/rollback, non-uniform adaptive pages and actual denied-row filtering. |
| `JOURNAL.md` | Append the round's dated result and scope. |
| `reports/20260924-intent-work-r2.md` | This report. |

Finding 3's forced 32-row fetch had already been removed by round 1. This
round additionally fixes adaptive fetches at one candidate, adds the explicit
non-uniform case, and proves the regression rejects reintroducing that batch.

The collector preserves the existing loop semantics: it selects the domain
before executing its body. It does not interleave writes with a changing scan.
Selected images remain charged; only their separately prepaid decoder scratch
is released after transferring the image into the retained row allowance.
The store's existing `scan_metered` preflight still precedes typed decoding.
Cursor bytes are charged as one maximum reservation per scan, not once per
row; variable key lengths can grow that reservation without assuming a fixed
payload size. Filter allocations, dependencies and retained state remain
charged. The 16 MiB job heap and all other runtime ceilings are unchanged.

## Executed forms and regressions

`work_intent_review2` adds:

1. `a_wide_key_domain_near_the_job_examined_ceiling_keeps_one_cursor`:
   `n = count(entries[] by byKey)` consumes 16,370 entries with 256-character
   indexed text keys in one job chunk, returns 16,370 and peaks at **22,233 B**.
2. `inner_job_domain_refuses_before_decoding_the_unaffordable_suffix`:
   `for entry in entries:` over 128 rows with 256,000-character bodies refuses
   with heap `E_BOUND`, parks at K=1 and commits no effects or permanent keys.
   A second run deliberately corrupts the final stored image. The old eager
   path decoded it and returned a store error; the fixed path still refuses
   on the earlier heap allowance without reaching that image. Both runs peak
   at **16,931,387 B**, including the refused charge, not successful live heap.
3. `adaptive_non_uniform_sweep_reads_one_large_candidate_at_a_time`:
   `for item in items: emit notify { id: item.id }` with
   `read <- .owner = viewer` and `payload: json <=1000000`. The system-principal
   job processes all 32 rows with 999,000-character JSON strings: K=2, five
   retries, 16 chunks and exactly 32 effects. Two additional ordinary payload
   bindings per item exercise K=1, six retries and 32 chunks. Neither parks.
   Reported peak **17,996,394 B** includes the refused larger attempts.
4. `allowed_prefix_visits_and_excludes_rows_denied_by_the_read_rule`:
   `count(items['shared'] by byScope)` and
   `sum(items['shared'] by byScope, .n)` use a schema-capped prefix whose scope
   predicate is allowed. Both examine all three rows, including Bob's denied
   row, and return Alice's count **2** and sum **18**. The existing non-uniform
   query incompleteness remains. The schema cap is intentional: uncapped
   non-uniform aggregate admission remains refused.

The original retained recipient-heavy control (5,000 candidates, 4,900 hits,
50 recipients per row) now peaks at **370,216 B**, down from **4,102,784 B**.
The ordinal/once digest variant peaks at **372,756 B**. The original fixture's
cumulative Rust allocation counter is **48,089,687 B**, allocation churn rather
than simultaneous retention or RSS. Scratch is now temporary in the meter;
this does not claim elimination of decoding.

The scheduled scale fixture still emits **50** digests in **26** chunks, final
**K=2**, **five retries**, across restart and rerun; peak is **1,309,094 B**
(including refused attempts), previously 13,188,641 B. The 9,000-tiny-row inner
domain and every round 1 regression continue to pass.

## Fault-injection evidence

Temporary mutations to `read.rs` produced the expected failures:

| Injected fault | Regression failure |
|---|---|
| Double key-decode scratch, even with matching release | Original fixture peaks at 371,846 B and fails its tightened envelope. |
| Remove the selected-row retention charge | Oversized inner domain incorrectly finishes; the test requires heap refusal and rollback. |
| Restore adaptive `max(take + 1, 32)` fetches | Non-uniform sweep parks at K=1 instead of completing. |
| Replace per-row `check_rule` with `true` | Alice's count becomes 3 instead of 2. |

All temporary faults were restored before final checks. Log:
`/tmp/lane-d-r2-mutants.log`. This also confirms finding 4's test actually
enters the denied-row path, rather than relying on a prefix-wide denial.

## Verification

**149 affected tests pass, one existing test ignored**: 22 intent/review/control
tests, 18 core corpus tests, 11 word-heap tests (one ignored), 55 guide tests,
10 language prefix tests, 7 device component tests, 14 device prefix tests,
and 12 server prefix tests. PostgreSQL feature compilation passes.
`git diff --check` passes; largest changed source is `read.rs`, 1,289 lines.

WASM: **1,714,371 B raw / 475,536 B gzip**, +1,328 raw / +216 gzip versus round
1. The existing **476,000 B** artifact budget is unchanged, with 464 B headroom.

`ref-check --verbose`: **504 LLP docs, 9,212 refs in 25,447 files, zero errors,
zero unchecked**.

The final `scripts/test.sh` run exits 1 and reports exactly:

```text
== 1 failure(s) in 151 s
   cargo test
```

Log: `/tmp/lane-d-r2-full-test.log`. Every failure is **baseline**, recorded
in `~/sb4-intent/baseline-test.log` and `BASELINE-FAILURES.md`:

| Failing test | Reproduction from `snapback4/` |
|---|---|
| `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The census mismatch is set-equal to baseline: 12 actual-only and 1
expected-only entries. All other suite stages pass. No new or environmental
suite failures remain. The four inherited failures above are the only open
problems observed in final verification; this round does not change them.

## Scope and open problems

No deviation from the requested behavior. Finding 3 includes confirmation of
the existing round 1 fix as well as the requested one-row fetch refinement.
Explicitly paged reads, full-text matching, admission, authorization, effect
transactionality, replay and prediction were not redesigned. No cross-lane
integration or external delivery claim is added.
