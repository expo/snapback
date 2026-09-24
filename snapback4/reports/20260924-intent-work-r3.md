# LLP 3000.013 lane D — Astra delta review

Both findings are fixed on `sb4-intent/d-work`. This report supplements the
[implementation](20260924-intent-work.md), [round 1](20260924-intent-work-r1.md)
and [round 2](20260924-intent-work-r2.md) reports.

## File-by-file changes

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/read.rs` | Seed the streaming scalar frame with prior horizon, missing-fact, word-expansion and presence uncertainty. This includes inputs evaluated before the frame, whether binder-hoisted bounds or saved locals. Continue observing the scalar's own scans without inheriting an outer page's non-uniformity. |
| `crates/snapback4-lang/src/guide/bounds.rs` | Explain that earlier unknown reads make a scalar unavailable even when a fallback supplies an ordinary value. |
| `crates/snapback4-sim/tests/work_intent_review3.rs` | Add three regressions: hoisted-prefix coverage, saved-filter-local coverage and the retained-cursor refusal boundary. |
| `JOURNAL.md` | Append this review's changes, measurements and limits. |
| `reports/20260924-intent-work-r3.md` | This report, including failure reproductions and fault-injection evidence. |

## Availability and executed forms

The interpreter does not track coverage provenance for each local value.
As requested, it conservatively carries earlier unknown coverage until it
can be proved unrelated. This may withhold an independent later scalar after
an unrelated unknown read; it does not assert that a fallback has resolved
missing data. The outer page's non-uniformity remains separate: the existing
owner-readable-folder/public-note regression still returns Alice's folder
and continuation for all three scalar predicates.

The new tests compile and execute these forms with online-only `prefs` and
fully synced, public `items`, indexed by `scope, id`:

```text
return count(items[prefs['p'].scope ?? 'none'] by byScope)
return sum(items[prefs['p'].scope ?? 'none'] by byScope, .n)
return exists items[prefs['p'].scope ?? 'none'] by byScope
```

With the preference unavailable on the device, each returns `data: null`,
`complete: false`. The server returns **1**, **7** and **true**, respectively.
The saved-local variants have the same contract, for example:

```text
scope = prefs['p'].scope ?? 'none'
return count(items[] by byScope where .scope = scope)
```

`sum` and `exists` over that filtered domain are covered too. Controls make
`prefs` fully synced: known absence legitimately yields **0**, **0**, **false**,
and a held preference yields **1**, **7**, **true**, all complete.

Earlier forms remain covered by the rerun lane fixtures: `for p in profiles:`
as an adaptive job sweep, inner `for m in members[p.principal] by byPrincipal:`,
streaming period counts and `emit push { ... } once [p.principal, periodEnd]`.
No syntax, IR, admission, authorization, expiry, effect or runtime ceiling
changes were needed for this delta.

## New tests and mutation evidence

1. `hoisted_prefix_coverage_governs_count_sum_and_exists` proves a prefix
   evaluated before scalar-frame entry retains its unknown coverage. It
   checks all three scalars against server answers and known-device controls.
2. `saved_filter_local_coverage_governs_count_sum_and_exists` proves the same
   for a prior local referenced by a scan filter. Both tests failed before
   the fix, returning integer zero instead of unavailable data.
3. `a_growing_retained_cursor_can_exhaust_the_heap_allowance` uses the memory
   store and a **5,000 B** heap ceiling. One row with a 32-character index key
   fits; adding a row with a 256-character key returns null/incomplete with
   a heap cut at **5,089 B** charged, including the refused charge. With the
   ordinary ceiling, the same two rows return a complete count of two.

Temporarily deleting only `self.meter.heap(retained - cursor_heap)?` makes
test 3 fail: the bounded query incorrectly returns **2**, complete. The
charge was restored before final checks. Logs:
`/tmp/lane-d-r3-before.log`, `/tmp/lane-d-r3-cursor-mutant.log`.

## Measurements and targeted verification

**87 affected tests pass**: 25 intent/control/review tests, seven device
component tests and 55 compiled guide tests. Logs:
`/tmp/lane-d-r3-intent-final.log`, `/tmp/lane-d-r3-components.log`,
`/tmp/lane-d-r3-guide.log`.

The original retained 5,000-candidate / 4,900-hit / 50-recipient fixture
still peaks at **370,216 B** under the unchanged **16 MiB** job ceiling;
the ordinal/once variant peaks at **372,756 B**. Scheduled scale still
produces **50 effects**, **26 chunks**, final **K=2**, **five retries** across
restart/rerun, with **1,309,094 B** peak including refused attempts.

WASM: **1,714,421 B raw / 475,748 B gzip**, +50 raw / +212 gzip versus round 2,
within the unchanged **476,000 B** artifact budget. `git diff --check` passes;
the largest changed source is `read.rs`, **1,298 lines**. Ref-check reports
**504 LLP documents, 9,212 references, zero errors and zero unchecked**.

## Scope

No deviation from the delta review. Conservative earlier uncertainty is the
requested implementation decision; per-value coverage provenance is not
added. The cursor fix already existed and now has a test that detects its
removal. No push, package publication or cross-lane integration was performed.

## Full suite and open problems

`scripts/test.sh` exits 1 with this exact summary:

```text
== 1 failure(s) in 184 s
   cargo test
```

Log: `/tmp/lane-d-r3-full-test.log`. All four failing tests are **baseline**,
also recorded in `~/sb4-intent/baseline-test.log` and `BASELINE-FAILURES.md`:

| Failing test | Reproduction from `snapback4/` |
|---|---|
| `genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` | `cargo test -p snapback4-core --test schema_capabilities_legacy genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier` |
| `uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` | `cargo test -p snapback4-device --test device uniform_word_expansion::search_wasm_fixtures_match_compiled_programs_and_authorized_snapshots` |
| `census::authoring_census` | `cargo test -p snapback4-device --test readauth census::authoring_census` |
| `w9b_why_operation_keeps_residency_and_cost_output` | `cargo test -p snapback4 --test check w9b_why_operation_keeps_residency_and_cost_output` |

The census difference is set-equal to baseline: **12 actual-only and one
expected-only** entry. All other suite stages pass. There are **no new or
environmental failures**. The four inherited failures above remain open;
there is no unresolved delta-review finding.
