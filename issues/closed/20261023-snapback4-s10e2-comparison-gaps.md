# S10e-2 prerequisites: close inherited executor comparison gaps

Status: Closed
Date: 2026-10-23
Resolved: 2026-10-23
Scope: Snapback 4, S10e-2 executor deletion
Related: [LLP 3000.009.001.000 §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores)

The lead has classified the two fix-round-2 re-reviews of S10e-1 at
`db16b0206d` (Sol and Grok, both **CHANGES REQUIRED**) as **S10e-2
prerequisites**, not S10e-1 landing blockers. These inherited comparison and
regression gaps **must be closed before deleting `PostgresEngine`**. The findings below preserve the original triage record; the S10e-2a
resolution and execution evidence follow them. The source reviews remain local at
`/tmp/s10e1f2-review-sol.md` and `/tmp/s10e1f2-review-grok.md`; the scenarios
below preserve their actionable evidence without committing raw reviews/logs.

Locations below are on the rebased S10e-1 tip `ec8b6a92e4`.

1. [x] **Stored receipt sequence** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:58` (Sol and Grok). The receipt projection compares outcome bytes and bindings but omits `_ops.seq`. A common Postgres `op10` receipt stored with `seq=0` and the correct sequence inside `outcome` passes those comparisons while sync acknowledgement reads the wrong sequence. Compare the complete stored record, including its sequence.

2. [x] **Missing receipts on both sides** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:62` (Grok). The receipt helper preserves `Option`, so `None == None` passes its equality check without proving the expected receipt exists. Require each expected sent/refused receipt to be present before comparing its fields; receipt presence must not depend on the later timestamp SQL checks.

3. [x] **Partial C1 evaluator read** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:105` (Sol and Grok). The `derived` evaluator read compares only data, sequence, meters and completeness. A different `next`, `tables`, `cut` or `pending_opening` with those four fields unchanged passes. Require full typed query equality.

4. [x] **Partial fixture mutation and replay comparisons** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:180` (Sol and Grok). First writes use `.reply()` plus meters; replays at lines 183–184 use only `.reply()`. A replay heap-meter increment passes, as does a replay with result `Int(71)` on common Engine and `Null` on the evaluator, because replay replies omit result and also omit meters, tables, events and `receipt_only`. Require full typed mutation/replay equality, retaining the fixture inputs.

5. [x] **Difftest query publication dependency** — `snapback4/crates/snapback4-difftest/src/execute.rs:184` (Sol and Grok). `run-stores` serializes query outcomes directly and drops serde-skipped `pending_opening`. Identical public fields with a spurious Postgres publication dependency therefore compare equal. Preserve this host-only query field in the comparison record, as mutations already preserve `receipt_only`.

6. [x] **Blanket difftest unsupported classification** — `snapback4/crates/snapback4-difftest/src/stores.rs:65` (Sol and Grok). `setup_error` classifies every `StoreUnsupported` family and the structural codes `E_QUARRY_EPHEMERAL`, `E_VIEW_KEY` and `E_POSTGRES_MAINTAINED_COLUMN` (lines 66–78) as unsupported. In an arbitrary campaign, a newly introduced unsupported family or one of those structural refusals exits successfully as `Unsupported` instead of failing. The fixed 32-seed count of two `time-publication` exclusions does not constrain arbitrary campaigns. Require an empty default allowlist and explicit, exact family/count dispositions for any campaign-specific exclusions; keep unsupported outside passed.

7. [x] **Corpus negative control misses failure accounting** — `snapback4/crates/snapback4-core/tests/corpus.rs:812` (Sol and Grok). The control toggles `pending_opening` / `receipt_only` and asserts only vector inequality at line 828. Regressing the real corpus to print disagreements without appending to `overlap_failed` or failing its final assertion would leave this control green. Exercise the actual disagreement accounting and failure path (lines 736–740 and 776) with a planted mismatch.

8. [x] **Cleanup regression abandons timed-out worker** — `snapback4/crates/snapback4-difftest/src/store_database.rs:297` (Sol). The spawned thread handle is discarded; the receive timeout at line 316 bounds the assertion, not worker cleanup. Restoring the original diagnostics `accept()` hang fails after ten seconds but leaves the worker blocked before `database.close()` until process exit. Use bounded termination and reaping, such as an owned subprocess, and prove no worker survives the timeout negative control.

9. [x] **Old evaluation versions lose the opening-family assertion** — `snapback4/experiments/postgres/tests/conformance.rs:381` (Grok). The old-version test checks only `E_STORE_UNSUPPORTED`. An unrelated unsupported family now satisfies the test for version 1 or 2. Pin `StoreUnsupported { family: "opening" }` so a different admission refusal cannot stand in for the version guard.

Original closure condition: close this ticket only after each scenario has a failing negative control and
the strengthened comparisons pass on the supported SQLite/common Postgres/retained
evaluator overlap, with prefetch on and off. Preserve exact outcomes, refusal
families and meters; record the closure evidence in the RFC deletion checklist.


## Resolution — S10e-2a, 2026-10-23

All nine comparison prerequisites are closed. No executor, original fixture
input, meter policy, allowance, timeout or RT0 table was changed. Raw evidence
remains outside Git in `/tmp/sb4-s10e2a/`.

| Item | Change and failing control | Local evidence |
| --- | --- | --- |
| 1 | Compare physical `seq`, exact outcome bytes, name, argument digest and timestamp under the expected principal/id. Stored seq 11 versus 0 with identical outcome seq 11 was accepted before. | `before-core.log`; stock oracle controls pass |
| 2 | Require both expected receipts before equality. Missing on both sides now fails independently of the timestamp assertion. | `before-core.log`; stock oracle controls pass |
| 3 | Full typed `QueryOutcome` equality for the C1 evaluator read. Cursor, tables, cut and host opening-dependency injections are all caught. | `before-core.log`; stock three-store C1 fixture passes both prefetch modes |
| 4 | Full typed `MutationOutcome` equality for fixture first attempts and replays. Controls cover result, every one of the seven meters, tables, events and `receipt_only`. Replay result and heap controls fail with the old reply comparison and pass with typed equality. | `before-core.log`, `before-replay.log` (2 failures), `after-replay.log` (2 passes); stock fixture passes |
| 5 | Query comparison records explicitly preserve `pending_opening`; device diagnostic records use the same serializer. The actual field detector catches a planted dependency with identical public fields. | `before-pending-opening.log`; final library controls pass |
| 6 | Empty default unsupported allowlist; exclusions require exact code/family, count and ticket, verified at close or drop. Missing, extra and unknown refusals fail. Restoring blanket classification makes the actual one-case campaign return a successful unsupported report and its regression fail. | `mutant-blanket-unsupported.log`; default seed-8 CLI exits 2, with retained reproduction in `default-campaign-repro/` |
| 7 | Inject into successful observations in the actual corpus loop and require its actual `overlap_failed` final assertion. The old vector-only control passes with accounting removed; the new control fails when either the real append or final assertion is removed. These are runtime results. | `old-corpus-control-misses-accounting-fault.log` (0), `mutant-corpus-no-accounting.log` (101), `mutant-corpus-no-final-failure.log` (101) |
| 8 | Own a bounded subprocess, terminate and reap before returning a timeout, retain a drop fallback, and clean only its recorded PID-bound namespace. The old timeout waiter leaves a live child at the deadline; the new 50 ms hang control verifies reaping before return. Restoring the original diagnostics accept hang fails the real ten-second regression and reaps worker PID 1402666. | `before-cleanup.log`, `mutant-cleanup-old-accept.log`; final cleanup controls pass |
| 9 | Versions 1 and 2 must return exactly `StoreUnsupported { family: "opening" }`. Assets, time-publication and unknown-family injections fail that assertion. | `before-old-version.log`, `after-old-version.log`; actual private-cluster version tests pass |

The supported overlap passes with prefetch on and off. The five-executor
295-card corpus passes its 22-test target twice: SQLite 210 passed / 85 named
skips; each common/evaluator Postgres arm 207 passed / 88 named skips; zero
unsupported, conformance failures or overlap disagreements. All 229 Postgres
family/oracle cases pass, as do the fixed store campaign and restored/fresh
world checks. C1 warm derived queries remain 20 calls off / 23 on on both
engines; the existing 32-room query witness remains 8/68.

No new executor discrepancy was exposed. The existing narrower
[time-publication profile](../20261023-snapback4-s10e2-time-publication-profile.md)
is now an explicit two-setup-refusal exclusion only in the fixed 0..32
campaign (two unsupported outcomes per prefetch oracle, outside passed).
Arbitrary campaigns and replays retain an empty default list. The
[existing Serializable stress issue](../20260916-snapback4-postgres-serializable-benchmark-failures.md)
again leaves the stock script red with SQLSTATE 40001; its workload, retry
budget and inclusion are unchanged. Every later script stage, including public
serving and its confirmed private-cluster shutdown, passes.

This closes the comparison ticket, not the six-item executor-deletion program.
The [JOURNAL](../../snapback4/JOURNAL.md) records final qualification and process
cleanup; the RFC retains the evaluation-only Serializable driver, remaining
family migration, known-difference dispositions and replacement evidence.
