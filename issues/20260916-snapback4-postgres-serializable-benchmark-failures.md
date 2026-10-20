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
