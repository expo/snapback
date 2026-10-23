# S10e-2 prerequisites: close inherited executor comparison gaps

Status: Open
Date: 2026-10-23
Scope: Snapback 4, S10e-2 executor deletion
Related: [LLP 3000.009.001.000 §3.4](../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores)

The lead has classified the two fix-round-2 re-reviews of S10e-1 at
`db16b0206d` (Sol and Grok, both **CHANGES REQUIRED**) as **S10e-2
prerequisites**, not S10e-1 landing blockers. These inherited comparison and
regression gaps **must be closed before deleting `PostgresEngine`**. This
ticket records review findings; no implementation fix or new execution result
is claimed here. The source reviews remain local at
`/tmp/s10e1f2-review-sol.md` and `/tmp/s10e1f2-review-grok.md`; the scenarios
below preserve their actionable evidence without committing raw reviews/logs.

Locations below are on the rebased S10e-1 tip `ec8b6a92e4`.

1. **Stored receipt sequence** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:58` (Sol and Grok). The receipt projection compares outcome bytes and bindings but omits `_ops.seq`. A common Postgres `op10` receipt stored with `seq=0` and the correct sequence inside `outcome` passes those comparisons while sync acknowledgement reads the wrong sequence. Compare the complete stored record, including its sequence.

2. **Missing receipts on both sides** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:62` (Grok). The receipt helper preserves `Option`, so `None == None` passes its equality check without proving the expected receipt exists. Require each expected sent/refused receipt to be present before comparing its fields; receipt presence must not depend on the later timestamp SQL checks.

3. **Partial C1 evaluator read** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:105` (Sol and Grok). The `derived` evaluator read compares only data, sequence, meters and completeness. A different `next`, `tables`, `cut` or `pending_opening` with those four fields unchanged passes. Require full typed query equality.

4. **Partial fixture mutation and replay comparisons** — `snapback4/crates/snapback4-core/src/engine/postgres/tests/oracles.rs:180` (Sol and Grok). First writes use `.reply()` plus meters; replays at lines 183–184 use only `.reply()`. A replay heap-meter increment passes, as does a replay with result `Int(71)` on common Engine and `Null` on the evaluator, because replay replies omit result and also omit meters, tables, events and `receipt_only`. Require full typed mutation/replay equality, retaining the fixture inputs.

5. **Difftest query publication dependency** — `snapback4/crates/snapback4-difftest/src/execute.rs:184` (Sol and Grok). `run-stores` serializes query outcomes directly and drops serde-skipped `pending_opening`. Identical public fields with a spurious Postgres publication dependency therefore compare equal. Preserve this host-only query field in the comparison record, as mutations already preserve `receipt_only`.

6. **Blanket difftest unsupported classification** — `snapback4/crates/snapback4-difftest/src/stores.rs:65` (Sol and Grok). `setup_error` classifies every `StoreUnsupported` family and the structural codes `E_QUARRY_EPHEMERAL`, `E_VIEW_KEY` and `E_POSTGRES_MAINTAINED_COLUMN` (lines 66–78) as unsupported. In an arbitrary campaign, a newly introduced unsupported family or one of those structural refusals exits successfully as `Unsupported` instead of failing. The fixed 32-seed count of two `time-publication` exclusions does not constrain arbitrary campaigns. Require an empty default allowlist and explicit, exact family/count dispositions for any campaign-specific exclusions; keep unsupported outside passed.

7. **Corpus negative control misses failure accounting** — `snapback4/crates/snapback4-core/tests/corpus.rs:812` (Sol and Grok). The control toggles `pending_opening` / `receipt_only` and asserts only vector inequality at line 828. Regressing the real corpus to print disagreements without appending to `overlap_failed` or failing its final assertion would leave this control green. Exercise the actual disagreement accounting and failure path (lines 736–740 and 776) with a planted mismatch.

8. **Cleanup regression abandons timed-out worker** — `snapback4/crates/snapback4-difftest/src/store_database.rs:297` (Sol). The spawned thread handle is discarded; the receive timeout at line 316 bounds the assertion, not worker cleanup. Restoring the original diagnostics `accept()` hang fails after ten seconds but leaves the worker blocked before `database.close()` until process exit. Use bounded termination and reaping, such as an owned subprocess, and prove no worker survives the timeout negative control.

9. **Old evaluation versions lose the opening-family assertion** — `snapback4/experiments/postgres/tests/conformance.rs:381` (Grok). The old-version test checks only `E_STORE_UNSUPPORTED`. An unrelated unsupported family now satisfies the test for version 1 or 2. Pin `StoreUnsupported { family: "opening" }` so a different admission refusal cannot stand in for the version guard.

Close this ticket only after each scenario has a failing negative control and
the strengthened comparisons pass on the supported SQLite/common Postgres/retained
evaluator overlap, with prefetch on and off. Preserve exact outcomes, refusal
families and meters; record the closure evidence in the RFC deletion checklist.
