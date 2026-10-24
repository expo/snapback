# Snapback 4 differential snapshot worker exceeds its setup guard

Status: Open
Date: 2026-10-24
Scope: Postgres differential-library snapshot worker; expo-build-450b
Related: LLP 3000.009.001.000.002 §3.4

The CPU lane's complete `bash scripts/test-postgres.sh` run above
`b3c4aa2bba` failed
`store_database::tests::failed_reused_snapshot_reports_sql_error_without_hanging_cleanup`
at `crates/snapback4-difftest/src/store_database.rs:330`: its child did not
publish `ready` before the unchanged 60-second setup deadline. The library
target reports ten passes and one failure in 112.88 seconds. Worker 434634
was killed and reaped by the existing harness; this is a setup failure, with
no reported store-oracle mismatch. The separate timeout-control worker
434635 was also killed and reaped as expected.

An isolated exact-name rerun of the same test passes in 1.01 seconds. Worker
491897 exits successfully and is reaped. The rerun uses the private PG16.15
cluster's Unix socket instead of the original run's loopback TCP URL; the
codec, worker, workload, timeout and cleanup code are unchanged. Other tests
from this lane are not running during the isolated witness. This changed
setup and passing rerun do not explain or erase the broad-run failure.

Next: capture worker setup phases and database waits when reproducing the
full library target. Preserve the 60-second bound and explicit cleanup;
do not classify a setup timeout as an executor discrepancy or raise the
guard without evidence. Raw logs remain outside Git in
`/tmp/sb4-cpu/check-postgres.log` and `check-snapshot-isolated.log`.
The [CPU report](../snapback4/experiments/postgres-commit-path/results-20261024-cpu/README.md)
records qualification and final process custody.
