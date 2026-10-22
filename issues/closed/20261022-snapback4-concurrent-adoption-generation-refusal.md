# Concurrent replay can receive E_GENERATION during live adoption

Status: Closed
Date: 2026-10-22
Scope: Snapback 4 live adoption, `tests/lifecycle.rs`
Severity: P2 (intermittent qualification failure; baseline attribution unknown)

K0-Q fix round 1's complete CLI repeat at
`eaa3a600989cb65f7907f48be6338fad69445fdf` failed
`sqlite_replay_survives_counter_split_and_an_offline_cli_backfill`.
The concurrent replay thread received HTTP 503 with:

```json
{"denied":{"code":"E_GENERATION","family":"generation","message":"the store adopted another backend; reopen this engine"},"generation":1}
```

The status assertion failed at `tests/lifecycle.rs:318`, followed by the thread
join at line 637. The helper does not print the URL: the thread first seeds
rows 800–1599 and then queries `/q/entries` twenty times, so the receipt alone
does not identify which door returned the refusal. Adoption simultaneously
splits the maintained counter and adds its backfill job. Do not infer a failed
commit, lost rows, or a baseline regression from this response.

The exact unchanged isolated command passed in 1.41 seconds:

```sh
cargo test -p snapback4 --test lifecycle -j 10 -- \
  sqlite_replay_survives_counter_split_and_an_offline_cli_backfill --exact --nocapture
```

Both the full repeat and isolated rerun used one outer test thread. The initial
full CLI run had passed this case. This is an observed adoption interleaving,
not a reproduced root cause. Investigate the generation-publication boundary
and determine whether the serving guarantee or this fixture's unconditional
200 expectation should change. Preserve identity and generation fences; do not
hide the race with a blind retry or remove the replay's data assertions.

Evidence: [K0-Q fix report](../../snapback4/reports/20261022-k0q/REPORT.md) and its
qualification receipt. Full and isolated logs are retained as
`/tmp/sb4-k0q-fix1/cli-repeat.log` and `cli-repeat-isolated-0.log` on
expo-build-450a. The full-run failure must remain visible even when affected
repeats pass.

A subsequent full lifecycle target with the final clock-only follow-up at
e888877fb5 passed all 29 cases (64.46 seconds), including this replay. The
follow-up changes clock admission and pause lifetime, not adoption or generation
fences; this pass does not establish a fix for the race.


## Resolution — 2026-10-22, K0-Q fix round 2

`96b7f976e8` adds a bounded `/q/` handoff: discard an `E_GENERATION` reader
and reopen behind adoption at most twice, then recheck authority against the
new reader. A genuine foreign activation still refuses. `aeb62378f7` fixes
the final witness's waiter count and creates its thread-local latency span on
the consuming request thread rather than transporting that span from the
committer. The initial two witness failures reproduced in isolation and remain
recorded; the repaired affected query selector passes 14 cases (one ignore).

The deterministic after-COMMIT/before-reader-replacement witness now receives
HTTP 200 with the correct row and new generation; the foreign-activation
control retains `E_GENERATION`. The complete CLI lifecycle target at
`aeb62378f7` passes all 29 cases in 40.75 seconds, including
`sqlite_replay_survives_counter_split_and_an_offline_cli_backfill` with its
original 1,600-row/62-edge assertions. No retry or data assertion was removed.
The full CLI run has separate diagnostic/clock/residency failures recorded in
the lane report; this resolution claims the completed lifecycle target and
focused witnesses, not a clean overall CLI suite.

Evidence: `/tmp/sb4-k0q-fix2-final/cli.log`,
`/tmp/sb4-k0q-fix2-final/adoption-fixed-repeat.log`, and the
[lane report](../../snapback4/reports/20261022-k0q/REPORT.md).
