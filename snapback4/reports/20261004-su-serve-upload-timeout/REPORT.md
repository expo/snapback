# Lane SU: held serve clients outlive their fixture work

2026-10-04 · eb1000 (`expose-builder-pixel`, Linux x86_64) · base
`2154dc163dc42e1808f12ef32e9468b2889407a3` · local commit only.
Rust 1.97.0, Node 24.13.1, Bun 1.3.14; default Cargo test profile.

The unmodified upload test reproduces the Darwin dry-run failure at the
original `serve_tests.rs:92` (`WouldBlock`, Linux errno 11) and `:1110`
(join panic). Its two parked clients exhausted their three-second read
budgets before the driver released WorkGate. The engine still answered the
third-upload refusal and query correctly.

## Fix

Only deliberately held exchanges use `exchange_held`: the driver's bounded
wait/probe budget plus 15 seconds for completion, capped at 60 seconds.
Connect, writes and reads share one absolute deadline, so partial I/O cannot
restart the budget. Uploads allow `2 + 2×3 + 15 = 23` seconds. Ordinary
progress probes retain their three-second read guards. Product timeouts,
work counts and assertions are unchanged.

The worker-adoption fixture shares a 30-second deadline across its two
post-claim setup waits, followed by two three-second probes and two
two-second metric waits: its client allows `30 + 2×(3+2) + 15 = 55` seconds.
Earlier worker startup/exit waits still allow 60 seconds. The spawn-refusal
client's four-second read guard remains below the server's five-second idle
and 30-second body deadlines, so draining the unfinished body still fails.
Delivery barriers
now use the existing bounded entry wait and panic-release guard; the effect
claim gate also releases on panic.

## Audit: every changed case

Paths below are relative to `crates/snapback4/`. Budget includes completion
margin unless noted. Every named assertion and variant remains.

| File | Test / cases | Held client budget |
| --- | --- | --- |
| `src/serve_tests.rs` | `upload_disk_work_is_bounded_and_does_not_hold_the_query_engine` | 23 s |
| same | `password_work_is_bounded_and_does_not_hold_the_query_engine` (signup and login) | 23 s |
| same | `dev_loopback_admits_eight_simultaneous_sign_ins_within_host_capacity` | 20 s |
| same | `a_poll_rechecks_session_liveness_after_waiting` | 20 s |
| same | `an_effect_claim_rechecks_service_session_after_waiting` | 18 s |
| `tests/latency/serve.rs` | `latency_engine_wait_is_attributed_to_its_request_and_dev_inspection_never_waits` | 27.12 s |
| same | `latency_reset_excludes_requests_that_arrived_in_the_previous_window` | 21 s |
| `tests/serve_adoption/mod.rs` | `atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes` (32 syncs and writer) | 25 s |
| same | `atomic_feed_sync_authenticates_before_wait_and_rechecks_after_it` | 17 s |
| `tests/serve_adoption/reads.rs` | `adoption_keeps_queries_and_sync_readable_and_serializes_writes_once` | 25 s |
| same | `a_write_queued_behind_adoption_does_not_keep_expired_authority` | 25 s |
| `tests/serve_adoption/authority.rs` | `bearer_is_checked_after_durable_and_ephemeral_mutation_lock_gaps` | 19 s |
| `tests/serve_adoption/saturation.rs` | `saturated_mutation_admission_reserves_query_and_sync_capacity` (five routes) | 23 s |
| `tests/serve_adoption/worker.rs` | `production_accept_loop_reads_while_exited_worker_waits_for_adoption` | 55 s |
| same | `production_accept_loop_reads_after_delayed_worker_exit` | 55 s |
| same | `production_accept_loop_waits_for_complete_worker_readiness` | 55 s |
| `tests/serve_delivery/mod.rs` | `binding_is_rechecked_after_waiting_for_the_executing_writer` | 17 s |
| same | `adoption_after_preflight_decodes_the_captured_signature_then_refuses_binding` | 17 s |
| `tests/serve_sync/concurrent.rs` | `detached_sync_never_skips_a_commit_after_its_snapshot` (all 32 schedules) | 23 s |
| `tests/serve_overload/mod.rs` | `failed_thread_spawn_refuses_unfinished_upload_and_releases_permit` | 1 s driver receive + 3 s response read, replacing 500 ms |

Searched Rust socket deadlines, exchange callers, gates/barriers, queued
engine ownership and channel waits throughout Snapback 4, plus JavaScript
socket/AbortSignal/request timeouts. No other instance of this race found.
Unchanged: requests required to answer *during* a hold (including malformed
claims, overload and detached reads); socket readers whose read starts only
after the driver releases the body/write; barriers preceding client startup;
route/ephemeral polls whose server wait is already shorter than the client
guard; JavaScript network guards using `hangBudget` (at least 122 seconds),
and intentional timeout-failure fixtures. The 60-second adoption-scale client
already exceeds its ten-second authorizer hold. Timing assertions remain.

## Verification

| Check | Result |
| --- | --- |
| Unmodified upload, CPUs 0–1 + eight CPU hogs + 4 s driver stall | **50/50 fail**, all at the reported client timeout; 4.074–4.152 s/run |
| Fixed upload, identical confinement/hogs/stall | **50/50 pass**; 4.060–4.212 s/run |
| Fixed upload, 25 s driver stall (negative control) | Expected failure; clients exhaust the 23 s deadline; join fails at 25.02 s |
| `cargo test -p snapback4 --bin snapback4 serve` | 189 passed, 0 failed, 4 existing ignores (53.94 s) |
| `./ref-check --verbose` | 527 LLPs, 10,342 references, 0 errors / unchecked |
| Rust workspace (full suite) | 4,968 passed, 33 existing ignores; 17 doctests passed |
| Client pool (311 files) | 6,185 passed, **2 failed**, 11 skipped |
| Serial models | 79 passed, 0 failed |
| Full `taskset -c 8-31 bash snapback4/scripts/test.sh` | **Exit 1**, one failed stage (client tests), 2,382 s |

The first broad serve run began before the fresh checkout's CLI binary was
built; worker launch retries drained once the suite built it, and the run
passed. The later spawn-failure timeout correction is covered by the full
suite and its focused rerun. Full-suite CPU affinity leaves the reproduction's
CPUs independent and limits client files to eight without reducing counts.

[Per-run records](./repetitions.json),
[baseline output](./baseline-repetitions.log.gz),
[fixed output](./fixed-repetitions.log.gz),
[negative control](./bound.log.gz),
[serve output](./serve.log.gz), [spawn-refusal rerun](./spawn-failure.log.gz),
[full-suite output](./full-suite.log.gz), and [reference check](./ref-check.log.gz).


The full client pool reported two failures in files byte-identical to base;
all production code is unchanged (the edited Rust modules are `cfg(test)`).
Neither is a held client's timeout:

- `release-activation.test.mjs:515`: scheduled crash-recovery job was `done`
  instead of `queued`. [Follow-up](../../../issues/20261004-snapback4-scheduled-job-crash-cut-race.md).
  Isolated rerun passed in 1.33 s.
- `worker-regressions.test.mjs:440`: helper `alive()` returned true after
  waiting for false in the SIGTERM case. [Follow-up](../../../issues/20261004-snapback4-watchdog-helper-liveness-fixture.md).
  Isolated rerun passed in 2.30 s; SIGINT/SIGHUP passed in the full run.

The isolated reruns do not turn the failed full suite green. Retained
[source equality](./unrelated-failure-source.txt),
[schedule rerun](./release-activation-rerun.log.gz) and
[watchdog rerun](./worker-regressions-rerun.log.gz) separate those observations.

[Reproduction details](./REPRODUCTION.md) preserve the temporary shim and
load driver. No production code changed. Sampled worktree plus scratch usage stayed below 24.1 GB (40 GB limit).
Temporary shims, copied binaries, load driver and scratch logs were deleted;
all owned load processes exited. Build artifacts remain in this lane.
No push or publication. All work
used this lane on eb1000; Lane FX's worktree was untouched.

Governance: [LLP 3000: publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
and [LLP 3000.019 §3.6](../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#36-p10-adding-a-view-never-stalls-reads).
The affected-scope audit found those decisions still applicable; this is a
fixture correction, recorded in the journal and closed ticket rather than a
new design decision.
