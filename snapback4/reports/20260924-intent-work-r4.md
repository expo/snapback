# LLP 3000.013 lane D — Grok delta review

Both findings and both surviving mutations are addressed on
`sb4-intent/d-work`. This supplements the [implementation report](20260924-intent-work.md)
and the [previous delta report](20260924-intent-work-r3.md).

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | For a selected inner-domain row, drop its fetched key, release its exact decoder/scratch allowance, then charge the retained image and row-vector growth before fetching another row. Do not charge or populate the unused result-key vector. Keep the separate cursor reservation and all non-transient charges. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Explain the replacement of decode scratch by retained-row allowance and that domains do not retain unused result keys. |
| `crates/snapback4-sim/tests/work_intent_review4.rs` | Three tests cover the exact large-row reproduction, unused-key allowance near the examined ceiling, and the observable streaming behavior of uniform schema-capped aggregates. |
| `JOURNAL.md` | Append this round's changes, evidence and scope. |
| `reports/20260924-intent-work-r4.md` | This report. |

The binder's uniform upgrade already implements the required behavior and
needs no production change. Its deletion is now detected by an execution
test. The temporary mutation was restored before final verification.

## Forms and tests

`three_large_inner_domain_rows_fit_after_decode_scratch_is_released` runs the
review's exact three public rows, each with a 2,000,000-character body under
`body: text <=8000000`, using:

```text
job sweep():
  for start in starts:
    n = 0
    for entry in entries:
      n = n + 1
    emit total { n } once [start.id]
```

It completes one chunk at **K=64**, with **zero retries**, and emits count
**3**. Peak metered heap is **16,014,923 B**, below the unchanged **16,777,216 B**
ceiling. This is not a 6 MB peak claim: the largest decode still overlaps
previously retained images. Before the fix the job parked at K=1 after six
retries, with **18,015,233 B** including the refused charge and no committed
chunk.

`inner_domain_near_the_examined_ceiling_retains_rows_without_unused_keys`
runs `for entry in entries: n = n + entry.n` over **16,370 rows**, emits their
correct total and completes one chunk. Peak falls from **5,565,503 B** to
**4,484,226 B**. The test's **5,000,000 B** peak assertion rejects retaining
the unused result keys. Rows and the row vector remain charged.

`uniform_schema_capped_aggregates_stream_and_withhold_cut_totals` uses a
public table with `cap 100`, ten rows and these forms:

```text
return count(items[] by byId)
return sum(items[] by byId, .n)
```

With ordinary ceilings they return **10** and **70**, complete. With an
examined ceiling of three, both return **null**, incomplete. A schema cap
does not permit a partial streaming total. Earlier non-uniform capped
compatibility tests still pass.

## Fault-injection evidence

The two requested temporary mutations now fail:

| Mutation | Observed failure |
|---|---|
| Charge `row.heap_bytes()` before releasing `row_bytes` | Three-row test parks at K=1 instead of completing; **18,015,131 B** including the refused charge. |
| Delete the uniform aggregate upgrade in `bind/program.rs` | Uniform capped count returns partial **3** instead of null. |

The unused-key test passes even with the overlap mutation, at **4,484,435 B**,
showing its threshold distinguishes the separate unused-key regression.
All mutations were restored. Logs: `/tmp/lane-d-r4-before.log`,
`/tmp/lane-d-r4-mutants.log`.

## Targeted verification and measurements

**90 affected tests pass**: 28 intent/control/review tests, seven device
component tests and 55 guide tests. Logs: `/tmp/lane-d-r4-intent-final.log`,
`/tmp/lane-d-r4-components.log`, `/tmp/lane-d-r4-guide.log`.

The earlier oversized inner-domain test still refuses before reaching its
deliberately malformed suffix and rolls back all effects and permanent keys.
It peaks at **16,926,861 B**, including the refused charge. Adaptive pages,
cursor reservation, hoisted-input coverage and outer-page isolation tests
remain green.

The retained 5,000-candidate / 4,900-hit / 50-recipient control remains at
**370,216 B** peak; the ordinal/once fixture is **372,664 B**. Scheduled scale
still emits **50 effects** across restart/rerun in **26 chunks**, final
**K=2**, **five retries**, now at **1,297,161 B** peak including refused
attempts. All runtime ceilings are unchanged.

WASM: **1,714,464 B raw / 475,764 B gzip**, +43 raw / +16 gzip versus the
previous delta, within the unchanged **476,000 B** artifact budget.
`git diff --check` passes; largest changed source: **1,302 lines**.
Ref-check: **504 LLP documents, 9,212 references, zero errors and zero
unchecked**.

## Scope and decisions

No deviation from the review. The existing select-before-body loop semantics
remain: retain the selected rows under the meter, then execute the body.
The scratch-to-image handoff replaces an allowance; it does not raise a
ceiling or omit the charge for retained rows. A refusal still unwinds and
rolls back the whole chunk. No new syntax, IR, diagnostics, admission,
authorization, expiry or effect behavior was introduced. No push,
publication or cross-lane integration was performed.

## Full suite and open problems

`scripts/test.sh` exits 1 and reports exactly:

```text
== 1 failure(s) in 164 s
   cargo test
```

Log: `/tmp/lane-d-r4-full-test.log`. Every failing test is **baseline**, also
recorded in `~/sb4-intent/baseline-test.log` and `BASELINE-FAILURES.md`:

| Failing test | Reproduction from `snapback4/` |
|---|---|
| `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The census difference matches baseline exactly: **12 actual-only and one
expected-only** entry. All other suite stages pass. No new or environmental
failures remain. The four inherited failures are the only open problems
observed; all findings in this delta review are resolved.
