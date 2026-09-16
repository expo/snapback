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
