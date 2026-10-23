# Snapback 4 Postgres serializable benchmark cells fail on an idle host

Status: Open
Date: 2026-09-16
Scope: Postgres evaluation executor and stress harness; not a production claim.
Severity: P3 (experimental mode; serialized target cells finish)

An idle PostgreSQL 16.15 run of `bash scripts/test-postgres.sh --bench` with
the default 200 iterations exhausted the unchanged 32-retry serializable
budget at `adb62150b`, returning PostgreSQL `40001` and aborting before JSON
was written. No retry, timeout, workload or durability tuning was performed.

At `ba92d4f32`, reporting retains cells, joins writers before advancing,
checks counters against successful commits, writes JSON, then exits 1 if
any cell failed. Both prefetch settings still have failed serializable cells:
on/disjoint 300/400 commits; off/same 200/400; off/disjoint 208/400. Those
retained errors have only `E_STORE: db error`, not SQLSTATE; do not assume
all have the first attempt's precise cause. All serialized target cells
complete 400/400 with zero retries. No lost increment was observed in the
final successful-commit counter checks.

Evidence and raw results:
[W9 integration report](../snapback4/experiments/postgres/W9-INTEGRATION-REPORT.md#failed-attempts-and-stress-cells).
Host: `450b`, Ryzen 5 3600, Ubuntu 24.04, 128 GiB; suites serialized;
98–100% idle before/after on, 100% before/after off, no swap traffic.

Next: preserve underlying SQLSTATE in future failure reports, then attribute
retry exhaustion under same/disjoint contention. Keep retry limits and
durability explicit. A changed retry policy is new work, not a retroactive
repair of this measurement. The separate unbound-replay issue remains C3.

## 2026-10-21 — evaluation conformance under the P1-JB checks

On expo-build-450a, the P1-JB fix-round-1 run of
`snapback4/scripts/test-postgres.sh` (main-mirror 1791e1a22b plus this lane)
finished the evaluation conformance target at 17 passed / 1 failed / 0 ignored.
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
completed Serialized (65 increments, zero retries), then two Serializable
writers returned SQLSTATE `40001` (`could not serialize access due to concurrent
update`) from the increment mutation at `tests/conformance.rs:244`. It was not
an attach failure or a jobs operation. The script stopped before its core stage.

An explicit isolated rerun with `--include-ignored --exact --nocapture` passed:
65 increments in each mode, zero serialized retries and 64 aggregate serializable
retries, no lost updates. This records the same serializable stress-failure
class in conformance; it does not establish a new root cause or change the
retry policy. All 86 core Postgres cases (including 25 jobs cases) and the
19-test Postgres corpus target passed when the skipped stages ran separately.
All were run with four Cargo jobs, incremental off and dev/test line-table debug
info. The private cluster was stopped and `pg_ctl status` confirmed no server.
## 2026-10-21 — P1-OB conformance observation

The P1-OB working tree above `9b2a9b468f` (the final contract-test slice not
yet committed), on expo-build-450a with PostgreSQL 16.15, also hit SQLSTATE
40001 after the existing 32-retry budget in
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`.
The ordinary stock script had RUST_TEST_THREADS=6; the other evaluation
tests, including the exhaustive prefetch loops, were active. The test's
serialized mode completed 65 increments with zero retries; serializable
workers returned `could not serialize access due to concurrent update`.
That conformance target finished 17 passed / 1 failed / 0 ignored.

An isolated rerun, with the same four concurrent writers inside the test,
passes both modes: 65 increments each, no lost updates, 84 total serializable
transaction retries. The same test in the subsequent stock-script run with
RUST_TEST_THREADS=1 passes with 86 total serializable retries and the same
65/65 outcomes. No product retry bound, backoff, timeout or durability input
changed. This is additional evidence for the open exhaustion question, not
proof that the outbox delta introduced or resolved it. Raw lane logs remain
in `/tmp/p1-ob-postgres-final.log`,
`/tmp/p1-ob-postgres-concurrency-isolated.log` and
`/tmp/p1-ob-postgres-serial-final.log` on this worktree's host.
## 2026-10-21 — P1-AS private-cluster qualification on expo-build-450a

The P1-AS worktree (`sb4-pg/p1-assets`, adapter commit `7d71bf237b` plus
shared conformance cases) reproduced PostgreSQL 16.15 SQLSTATE `40001`,
"could not serialize access due to concurrent update", in
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
(`experiments/postgres/tests/conformance.rs:244`, joined at line 257).
The serialized half completed 65 increments with no lost updates and zero
transaction retries; a serializable worker then errored. The full
`scripts/test-postgres.sh` run used four Rust test threads, Cargo `-j 6`
(via CARGO_BUILD_JOBS), incremental off and line-table debug information.
Another authorized lane shares this host; this is not an idle-host claim.
The script continues to run the gated family contracts after this failure.
No retry, timeout or durability policy was changed.

The isolated rerun of that exact conformance test passed (one test, zero
failed/ignored): 65 serialized increments with zero retries, and 65
serializable increments with 107 retries, with no lost updates. It used
`cargo test --locked -j 6 --manifest-path experiments/postgres/Cargo.toml
--test conformance concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes
-- --include-ignored --nocapture --test-threads=1` on a new socket-only private
cluster. The full run's core Postgres tests passed 100/100 (all 21 P1-AS
asset tests executed, zero ignored); its corpus tests passed 19/19, with
207 Postgres cases passed and 88 named exclusions. Both owned clusters
were stopped and `pg_ctl status` confirmed no server running (exit 3):
`/tmp/sb4-pg-eval.JYlct6` and `/tmp/p1-as-pg-isolated.R89G7b`. This remains
an experimental serializable flake, not a new asset-ledger failure.

## 2026-10-21 — S10b semantic-boundary qualification

Lane `sb4-pg/s10b`, base `1250ea3b3d`, on expo-build-450a reproduced this
existing conformance failure in both the ordinary script run and a complete
rerun with `RUST_TEST_THREADS=1`: 17 conformance tests passed and the same
concurrent increment/duplicate-id case returned SQLSTATE `40001`. The exact
filtered test passed on a separate private cluster in 6.94 seconds: 65
increments in each mode, no lost updates, zero serialized retries and 130
aggregate serializable retries. Test-function serialization does not remove
the test's four internal concurrent writers.

The corrected S10b family harness then passed all 188 core Postgres tests,
and all 19 corpus tests passed with the existing named exclusions. Because
Cargo stopped the standalone experiment at its failed conformance target,
the other four experiment targets were run explicitly on another private
cluster: 40 passed / 0 failed / 0 ignored. Thus all other 57 experiment tests
passed, and the remaining case passed alone; neither full script invocation
was wholly green. No retry, timeout, backoff, durability or workload bound was
changed. The evaluator's `mod.rs`, `store.rs`, and this conformance scenario
are unchanged from the S10b base. This adds an observation to the existing
intermittent-exhaustion record rather than attributing a new root cause.

All four owned clusters were stopped and independently confirmed with
`pg_ctl status = 3` and no `postmaster.pid`: `/tmp/sb4-pg-eval.o3kYNb`,
`/tmp/sb4-pg-eval.Sc62TO`, `/tmp/sb4-s10b-pg-isolated.imP1D4`, and
`/tmp/sb4-s10b-pg-check.COWSJw`. Data was retained. Details and remaining
SQLite/device qualification are in the
[S10b report](../snapback4/reports/20261021-s10b-semantic-store-boundary.md).

## 2026-10-22 — S10c blind-review A/B evidence

Sol's blind review of lane S10c used private PostgreSQL 16.15 clusters with
locale C and ran the exact
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
case **13/13 successfully on `bd4d265df5` and 13/13 on `ad87e0ddb3`**.
Every run retained all 65 increments. Clean evaluator suites passed all
58 tests on both revisions. In the first six isolated runs, all **461**
instrumented serialization errors occurred at **`UPDATE r`**, before tail
completion. The retry loop still encloses the entire transaction, including
commit; the evaluator does not use `SAVEPOINT member` and discards the
completed transaction's head cache.

These reviewer observations do not reproduce a persistent S10c regression or
attribute earlier exhaustion to its tail ordering. Contention-timing effects
remain unverified. Grok separately passed 8/8 HEAD and 2/2 base runs on private
default-C clusters, with 65 increments per mode and no lost updates. The
original failures and this ticket remain open evidence; **no retry limit,
backoff, timeout, durability or workload policy changes** are made in S10c fix
round 1. Review source: `/tmp/s10c-review.md` on expo-build-450a; see the
[S10c report](../snapback4/reports/20261022-s10c-postgres-arm.md).

## 2026-10-22 — S10c fix-round-1 full-script observations

Both evaluator-enabled full default-C runs on expo-build-450a pass the exact
concurrency case: 65 increments per mode, no lost updates, zero serialized
retries and 93 aggregate serializable transaction retries in each run. No
40001 exhaustion was observed, so an isolated concurrency rerun was not needed.
The final complete Postgres script exits zero after aligning the three local
package versions in its stale lockfile and refreshing local debug artifacts
at shared-target manifest handoffs. These are qualification-path corrections;
retry limits, backoff, timeout, workload and durability policy remain unchanged.
The stress ticket remains open; these passes do not establish a root cause.

Runtime changes are `fc7e2eb740` and the evaluator-report adaptation
`a1b6a53138`, followed by the qualification/guard/cache-handoff record. Logs:
`/tmp/s10c-r1-checks/postgres-metadata.log` and `postgres.log`; the preceding
lockfile-only preflight failure is retained separately. All three owned
clusters are independently confirmed stopped (status 3, no postmaster.pid).
See the [round-1 report](../snapback4/reports/20261022-s10c-postgres-arm.md#s10c-fix-round-1--2026-10-22).

## 2026-10-23 — RT5 fix-round-1 qualification

The RT5 worktree above `8f6d9b0b0d` reproduced SQLSTATE 40001 from the
increment at `experiments/postgres/tests/conformance.rs:244` (joined at line
257) in the full en_US.utf8 PG16.15 script: 371 Rust passes / one failure,
with all remaining stages and the public serving/P1-MC milestone passing.
Serialized completed 65 increments with zero retries; a Serializable worker
returned `could not serialize access due to concurrent update`.

The required isolated rerun **also fails** with the same SQLSTATE and site,
after Serialized again completes all 65 increments with zero retries. It ran
the exact conformance executable produced by the script, filtered with
`--exact --include-ignored --nocapture`, on the lane's separate en_US.utf8
database. The executable hash, full outputs and cleanup are retained in the
[RT5 fix-round-1 report](../snapback4/reports/20261022-rt5-flight-mechanism/REPORT.md#fix-round-1-checks-and-cleanup--2026-10-23).

RT5 changes no evaluator source, mutation or retry path, and the evaluator
has no literal-codec calls. No limit, backoff, timeout, concurrency or
durability input changed. This adds a repeated occurrence of the open stress
failure, not a root-cause attribution or a claim of a green full script.
All owned PG16 clusters are stopped, with status 3, no postmaster.pid and
absent PIDs; all eight codec/flight tests pass on both C and en_US.utf8.

## 2026-10-22 — K0-Q rebase qualification

At `07d53b5258` on base `8f909dc734`, the first stock Postgres script's
retained evaluator case
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
exhausted the existing retry budget with SQLSTATE `40001` at
`tests/conformance.rs:244` (`could not serialize access due to concurrent update`).
The case exercises the retained `PostgresEngine` directly. This lane changes
neither that evaluator nor `engine/postgres/` implementation files.
All 209 common-engine adapter, 21 ownership and six queued-command cases passed;
the same first script also passed its handle/docs/member/HTTP/corpus stages.

The exact failing test binary (SHA-256
`658114e6198ec1b11412f5421a012f2b08bdad489f8ffd4a116a1b7f59bbef7b`)
passed the exact case alone, retaining 65 increments in each mode, zero
serialized retries and 95 serializable retries. A single complete stock-script
repeat with one outer test case at a time then passed all 58 evaluator cases
and every common-engine stage; the concurrency case kept 65 increments per
mode with zero serialized and 69 serializable retries. Its internal four
writers, operations, 32-retry cap, backoff, timeouts and durability are unchanged.
The ticket remains open; no root cause or contention-timing attribution follows
from these passing repeats.

Transcripts: `/tmp/sb4-k0q-rebase/postgres.log`, `postgres-isolated.log` and
`postgres-repeat.log`. All three corresponding clusters are stopped and
independently confirmed with status 3 and no postmaster.pid. The
[K0-Q rebase report](../snapback4/reports/20261022-k0q/REPORT.md#fresh-rebase-qualification)
retains source, binary, check and cleanup receipts.


## 2026-10-23 — K0-Q fix round 2 conformance observation

Both complete `scripts/test-postgres.sh` runs escape raw `40001` (concurrent
update) in `concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
at `tests/conformance.rs:244`, followed by the join at :257. This is the
standalone evaluator fixture, not a production serving claim; the mode at the
full-run failure is not recorded. The first run also had a separate stale
queue-fixture compile gap, repaired before the complete repeat. That repeat
runs every core stage, with 376 Rust passes and this one evaluator failure;
public serving and all exact RT0 rows pass.

The exact unchanged conformance rerun on the restarted owned evaluation
cluster passes both modes: 65 increments with no lost updates, 0 serialized
and 89 serializable total transaction retries. No retry budget, workload,
durability or timeout was changed. Full and isolated logs are
`/tmp/sb4-k0q-fix2-final/postgres{,-repeat}.log` and
`postgres-concurrency-isolated.log`; the lane report retains all results.
The restarted cluster is independently confirmed stopped.

## 2026-10-23 — P1-EV-1 fix round 2 conformance observation

Above `f8c54693c129`, the stock Postgres script's retained evaluator conformance
target finishes 17 passed / 1 failed: the existing concurrent read/modify/write
case escapes SQLSTATE `40001` at `tests/conformance.rs:244`, then its join at
:257. EV-1 changes only the dormant restore walk; evaluator source and the
mutation/retry path are unchanged.

The exact failing executable (SHA-256
`619849a44b8ce663c95fa1caceafeff4a379ceeb68e8299f6e96d8b2e21d6dd5`)
passes the exact case alone: 65 increments per mode, no lost updates,
zero serialized and 96 total serializable retries. No retry bound, backoff,
internal writer concurrency, timeout or durability input changed. This adds an occurrence,
not a root-cause attribution or a green full-script claim. Final stage
results and owned-PG16 cleanup are in the
[P1-EV-1 round-2 report](../snapback4/reports/20261023-p1-ev1-schema-evolution/REPORT.md#fix-round-2--2026-10-23-restore-byte-parity).
Raw logs and process traces remain outside Git under `/tmp/sb4-p1ev1-fix2/`.
## 2026-10-23 — S10e-1 fix round 1 retained race disposition

S10e-1 keeps the original increment/duplicate-operation stress as
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`.
The migration also retains the original Serializable refused-receipt race as
`evaluator_racing_refused_operations_replay_one_receipt_without_advancing_head`,
beside its common-engine serial replacement. Both oracle fixtures reproduced
40001 in the initial lane evidence. Per the lead's fix-round instruction, the
additional oracle race is ticket-ignored with this same reason and explicitly
excluded from the private runner's `--include-ignored` sweep. The original
stress remains enabled there; its red is never turned into a qualification.
The exact race body, common serial witness, mismatching-receipt oracle,
four-writer stress workload and existing retry budget are preserved.

## 2026-10-23 — S10e-1 fix round 2 private sweep

The stock private runner again reproduced `40001` in
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`:
two Serializable writers failed the unchanged increment unwrap at
`experiments/postgres/tests/conformance.rs:294`, then the parent join failed.
That source is unchanged from `9766d2ffe1`. Conformance finished 20 passed /
1 failed / 3 existing ticket exclusions; the added 32-room query witness passes
at 8/68 calls and both exhaustive precharge sweeps pass. Common serial
concurrency and receipt races pass. The runner continues after this red; no
retry, timeout, skip or comparison change was made. See the
[S10e-1 report](../snapback4/reports/20261023-s10e1-evaluation-callers.md#fix-round-2--2026-10-23)
for the complete sweep and cleanup disposition. This is the same experimental
failure class, not a new production retry claim.

## 2026-10-23 — S10e-2a comparison closure sweep

The stock private PG16 script again escapes SQLSTATE `40001` (concurrent
update) in the retained
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`:
the writer unwrap at `experiments/postgres/tests/conformance.rs:294` fails,
then the parent join at :307 fails. The common serial concurrency witness and
both mismatching-receipt witnesses pass. S10e-2a changes the old-version
opening-family assertion in this file; the stress body, retry implementation,
workload, timing bounds and runner inclusion are unchanged.

This records the existing experimental failure class, not an executor
difference exposed by a tightened comparison or a green full-script result.
All later script stages pass, including the supported five-executor overlap,
public serving and owned-cluster shutdown. Evidence remains outside
Git in `/tmp/sb4-s10e2a/test-postgres.log`; the S10e-2a JOURNAL entry records
the final check and owned-process cleanup results. No exclusion is added.
## 2026-10-23 — P1-EV-2 private sweep

The unchanged stock runner reproduced `40001` in
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
at `experiments/postgres/tests/conformance.rs:294`, followed by the parent join
at line 307. The conformance target finished 20 passed / 1 failed / three existing
ticket exclusions. Its source is byte-identical to the lane's `19ac8b7e47` base.
An isolated rerun of the exact saved executable passed in 4.04 seconds: 65
increments in each mode, no lost updates, zero serialized retries and 119
Serializable retries. It ran during the stock runner's compile-only handoff,
with no other test workload on this lane's private cluster. No workload, retry,
timeout or skip changed. The broad-run red is retained as a red. Qualification
and process cleanup are recorded in the
[P1-EV-2 report](../snapback4/reports/20261023-p1-ev2.md); raw evidence remains
outside Git under `/tmp/sb4-p1ev2/`.
