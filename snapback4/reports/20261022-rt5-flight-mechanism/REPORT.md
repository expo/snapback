# RT5: flight mechanism

Branch `sb4-pg/rt5`, base `22811380194f53ae9db9cde708ca70827a8fb6c2`.
This is test/experiment code. Serving and attach DDL use neither candidate.
The [context pack](./CONTEXT.md) names the governing constraints.

Candidate (a) passes the codec and ordering qualifications. Candidate (b)'s
VOLATILE PL/pgSQL envelope also passes the lock-wait witness. Evidence favors
(a) as the next candidate, **conditional on the lead's Hetzner latency run**;
loopback numbers cannot adopt B2. No extended-protocol stall is explained here.

The encoder emits ASCII SQL with explicit casts, UTF-8 hex text conversion,
hex bytes and typed ARRAY constructors. It never interpolates raw values or
uses session-dependent string escaping. Text output pins and verifies
`client_encoding=UTF8`, `extra_float_digits=3`, `bytea_output=hex` once per
physical connection. Other formatting/localization settings cannot change the
admitted types. The tests start with SQL_ASCII, lossy float output, bytea escape,
SQL/DMY DateStyle and both standard_conforming_strings settings before
qualification. The full Postgres script uses an en_US.utf8 cluster.

Coverage: NULL/optional scalar and array values; bool; i16/i32/i64 endpoints;
shared-policy saturated i64 endpoints (no saturation inside the codec);
f32/f64 endpoints, smallest subnormals, negative zero, NaN and both infinities;
empty/quoted/backslash/dollar/control/unicode/combining text; all 256 bytes;
empty arrays, NULL elements and nested text/bytea quoting. Tail parameters
$8–$25 are tested together in their exact 18-slot type order. Each of two
hostile settings configurations also runs 256 fixed-seed integer/float/text
cases. NUMERIC, dates, multidimensional/non-unit-bound arrays and custom
text-format ToSql values are not port inputs and refuse explicitly. NaNs
compare as NaNs; other floats compare exact bits, preserving negative zero.
Server integer overflow/division errors compare SQLSTATE, message and detail;
both paths remain aborted. Scalar, optional and array NULs compare exact
`E_INPUT` messages and prove caught errors cannot recover a savepoint, run a
later statement or commit prior writes.

The error-at-command-k witness tests every position in a three-command flight.
A sequence records how many commands actually ran even after rollback; later
commands never execute. Fence and generation refusals abort, as does the
prototype's zero-row tail. For visibility, A holds the head and changes the
generation/authority/receipt. B's prepared execution is observed in
`pg_blocking_pids` before A may commit. Ordered SimpleQuery and `sb4_open`
return generation 2, authority `after`, receipt `after`. The single-statement
VOLATILE SQL-language control returns generation 1, authority `before`, receipt
NULL: its internal SELECT has the snapshot from before waiting. This proves
that composed SQL control fails, not that every possible SQL-language function
fails. RT5 keeps the RFC's narrower, non-inlined PL/pgSQL candidate.

## Non-qualifying loopback smoke

PG16 private cluster on 127.0.0.1:55491; unchanged durable settings, C=32,
1-second warm-up + 4-second measurement, 3 fresh processes per cell. Read
address dependencies, three increment program steps, client tail validation
and separate COMMIT are preserved. The baseline is B1's per-statement shape,
not RT0's duplicated authentication. Models fetch only test facts; they do
not run the interpreter or represent serving performance.

| Shape | Form | Flights | Executions/s median | p50 ms median | p99 ms median | Worst p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| W1 | per statement | 6 | 26,636 | 1.229 | 2.726 | 2.780 |
| W1 | (a) SimpleQuery | 3 | 34,920 | 0.917 | 2.057 | 2.225 |
| W1 | (b) PL/pgSQL | 5 | 29,573 | 1.069 | 2.512 | 2.843 |
| mutation | per statement | 16 | 226.0 | 145.983 | 444.301 | 698.207 |
| mutation | (a) SimpleQuery | 8 | 227.5 | 143.413 | 372.215 | 401.179 |
| mutation | (b) PL/pgSQL | 11 | 230.0 | 32.954 | 705.055 | 1,050.449 |

All 18 measured repetitions pass transcripts and counters, including warm-up
and drain. Mutations share one head: backend samples are predominantly tuple
lock waits with WALSync visible. Nearly equal throughput and very different
latency distributions do not establish a network-flight win. In particular,
(b)'s lower p50 is accompanied by its much worse tail. The smoke does not meet
an engine SLO or measure an open-loop workload.

[Raw smoke records](../../experiments/postgres-commit-path/results-20261022-rt5-loopback/summary.json)
include per-run percentiles, rates, WAL, waits, load, correctness, source and
binary hashes, 33 recorded child lifetimes, and a successful cleanup receipt.
The [experiment README](../../experiments/postgres-commit-path/README.md#rt5-flight-mechanism-qualification-2026-10-22)
gives the exact target/password-file commands for the lead's 450b→450a run,
with separate S1b-style SSH streams or explicitly labelled direct TCP.

## Checks and cleanup

The check runner records commands, exit status, duration and owned PID in
[checks.json](./checks.json); complete output is alongside it.

- `cargo build -p snapback4`: pass. The final ordinary CLI has no candidate
  literal-codec symbols.
- `cargo check -p snapback4-core --no-default-features`: pass.
- `cargo test -p snapback4-core --no-fail-fast`: 1,075 unfiltered passes,
  five named ignores, plus one passing subprocess check.
- Corrected standalone RT5 qualification: 5/5 pass, including the native Bind
  decoder oracle; the locale script independently repeats all five successfully.
- Full `scripts/test-postgres.sh` retry: **369 Rust passes, no Rust failures**;
  overall exit 1 because its separate public bootstrap/deploy witness exceeded
  its existing 45-second subprocess guard at the failed-binding case (line 139).
  This also happened in the first run. **Rerun alone passes:**
  `python3 scripts/test-postgres-serve.py`, same en_US.utf8/PG16 environment,
  completes the full public-serving and P1-MC milestone (272.72 s overall).
  The cause of the full-script timeout is unisolated; no limit was raised.
  [Follow-up ticket](../../../issues/20261022-postgres-public-bootstrap-witness-timeout.md).
- `./ref-check`: pass, 565 LLPs / 11,759 refs / zero errors or unchecked refs.
  The final documentation pass is retained separately.
- RT5 release harness build and all 18 smoke repetitions: pass. The historical
  default harness build fails with nine SQLite raw-handle errors, independently
  rerun alone; use the documented `--features rt5` scope for these PG cells.

[Cleanup receipt](./cleanup.json): all six owned PG16 postmaster lifetimes
(319073, 501389, 576252, 590474, 864864, 894705) have status 3, no postmaster.pid,
and absent PIDs. All six recorded public serve PIDs and 33 benchmark child
processes are stopped; 59 recorded PID checks are empty, and no executable
from this lane's target is running. **PIDs left: none.** PG17/55440 was untouched.
Private cluster data remain in their recorded /tmp directories for inspection.

Disk stayed above the stop threshold (minimum observed: 29 G on `df -h`).
Only this lane's old, closed, prior-day B3 generated database cache was removed
(8.19 GB, 8,180 files); the cache-cleanup receipt records the scope. No compiled
or active artifacts were removed by that cache cleanup. The existing PG script
also performs its own documented shared-target package clean at each handoff.

The historical harness default build independently reproduces nine pre-existing
SQLite raw-handle compile errors after the store-port extraction. The `rt5`
feature builds the same harness without those historical SQLite modules; it
adds no raw handle to the core. The experiment lockfile is refreshed for the
already-current core/lang/device path versions, without dependency upgrades.
Initial local validation corrected a witness setup error: its sequence must
be created in a completed command before BEGIN so rollback cannot remove it.
The final test-file split also needed explicit driver imports and a corrected
connect call. The corrected standalone run passes all five tests with the
independent native Bind decoder oracle. Failed attempts remain in the logs.
The smoke precedes a whitespace-only codec EOF cleanup, a fixture reference
comment and those test-only edits; encoded SQL and executed statements are unchanged.

Initializing the missing LLP skill briefly registered its submodule in Git's
shared config. Only that exact new registration was removed immediately;
prior Git configuration was restored. No push, stash, other worktree access,
remote execution or PG17/55440 access was performed.
