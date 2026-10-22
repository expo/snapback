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
