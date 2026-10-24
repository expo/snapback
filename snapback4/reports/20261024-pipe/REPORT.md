# PIPE: independent PostgreSQL reader statements

Branch `sb4-pg/pipe`, expo-build-450a. Initial required base `bd50485b8c`;
rebased onto updated landing base `480f88e8b4`. Qualified code is
`4ca669e894`. The rebase retained upstream's
`store::Row` spelling of the same `flight::Row` re-export; all other tree
contents match the preserved pre-rebase checkpoint. No push or publication.

The governing context is LLP 3000, store-port §8, round-trip §3.6/§13 and
accepted controls RFC §12. M1b's Nagle stall/removal evidence is supplied by
the author; its named branch was unavailable from this lane's origin.
No independent delayed-link claim is made here.

## Design and bounds

Detached logical readers share at most 30 physical connections, with
`SNAPBACK4_POSTGRES_PIPELINE_DEPTH=1..8`, default 4. A single reader I/O
runtime thread drives pinned tokio-postgres 0.7.18. Independent G4a facts
and ingress statements use Parse/Bind/Describe/Execute/Sync in one flight,
with one Sync and implicit transaction/snapshot per query. No BEGIN groups
independent reads. Binary rows use the existing FromSql decoder; the typed
literal encoder still checks composed parameters, NUL and byte admission.
SQL fetches facts; shared Rust retains authority, rules, execution and meters.
No result or allow bit is cached across requests.

Multi-statement fallbacks block under exclusive physical-connection custody
through their ordinary repeatable-read rollback. Other pipeline requests
cannot enter that transaction. Failed speculative SQL reopens ordinary
facts in a fresh cut. Transport loss returns retryable errors without
replaying an in-flight query. Future requests may replace an already-closed
socket, discard its statement caches and verify expected store id/generation.
A failed binding check stays pending. This also recovers the cached factory.

Retiring a logical reader reclaims only its own SQL PREPARE names under
exclusive custody. Cleanup is asynchronous protocol housekeeping, like
driver statement close; it adds no request wait. This prevents surviving
pooled sockets from retaining an unbounded history of retired caches.
The synchronous writer/lease driver, ordered commands and commit cut remain.
Both transports pin UTF8, extra_float_digits=3 and bytea_output=hex and verify
session affinity. The pinned connector sets TCP_NODELAY before TCP startup.

HTTP admission stays 30 active short workers plus 98 queued sockets. For a
pure W2/W3 HTTP load, that bounds active database requests at 30 and leaves
the larger pipeline depth underused. The core load independently supplies
128 concurrent logical readers to exercise cross-request pipelining. No
connection cap, logical meter, workload guard, retry or durability bound rose.

## Witnesses

All five transport/lifecycle tests pass, covering independent snapshots and
statement errors, exact connection-loss scope, exclusive fallback custody
and bounded depth, TCP_NODELAY, and prepared-name retirement. TCP tracing
confirms two successful TCP_NODELAY=1 calls covering reader and synchronous writer.
The loss case preserves a completed result and a healthy neighbouring
connection while all three outstanding requests on the terminated backend
receive retryable errors. Startup verifies the pinned codec/read-only settings.

All eleven real closure/fallback oracles pass on detached readers. They cover
three-way PostgreSQL pipeline / ordinary PostgreSQL / SQLite outcome and
logical-meter parity, every ceiling cut, maintained totals, planted faults,
retained NUL/default/empty cases and the commit/revocation cut. A real failed
pipelined session-facts view is repaired and authority revoked before fallback;
the result is fresh E_AUTH. A terminated shared factory/request socket recovers
for future reads; a substituted store id refuses twice with E_GENERATION.
The additional manual measurement function is inactive in the oracle sweep
and is not counted as an oracle.

The prepared-state regression was run before its fix: both names survived
one owner's retirement (2 versus expected 1). After the fix, sixteen paired
retirement cycles return to baseline and the surviving neighbour still executes.

## Measurements

Private PG16.15 TCP loopback, Ryzen 5 3600 (6 cores/12 threads, affinity 12),
Rust/Cargo 1.97.0, test opt-level=1, line-tables-only debug, Cargo -j6.
Each depth/operation has one common five-second window after client warm-up;
128 closed-loop clients, at most 30 physical readers, one I/O thread.
Latency includes queueing and result parsing. No other lane-owned build or
test runs concurrently with a measured window. No delay proxy is used.
These short shared-host samples are not S1 capacity/SLO or control-rung results.

HTTP uses the existing RT0 fixture: 25 messages/newest 20, 32 scalar room totals,
and a new TCP HTTP connection per request. Successful reads:

| Depth | W2 reads/s | W2 p50 / p99 ms | W3 reads/s | W3 p50 / p99 ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 3,548 | 35.30 / 51.38 | 1,892 | 65.82 / 100.93 |
| 4 | 3,538 | 35.34 / 52.30 | 1,880 | 66.43 / 95.89 |
| 8 | 3,653 | 34.48 / 49.14 | 1,974 | 64.01 / 83.20 |

There are 15 admission 503s across the six HTTP samples: W2/W3 at depth 1
= 0/2, depth 4 = 2/0, depth 8 = 0/11. Every such response is E_RATE_LIMIT;
all successful responses have complete valid 20-row/32-row results. HTTP before/after one-minute
loads are 17.76/23.74, 23.74/26.74 and 26.74/28.43 on this 12-thread host.
Changing depth alone shows no large HTTP throughput lift under 30 active workers.

Core uses 34 memberships and twenty messages per room with real maintained totals:

| Depth | W2 reads/s | W2 p50 / p99 ms | W3 reads/s | W3 p50 / p99 ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4,480 | 27.83 / 45.21 | 2,268 | 55.04 / 87.75 |
| 4 | 4,554 | 26.56 / 67.58 | 2,299 | 53.43 / 110.91 |
| 8 | 4,610 | 26.25 / 66.88 | 2,312 | 53.31 / 113.46 |

Core before/after one-minute loads are 4.82/7.42, 7.42/12.75 and 12.75/17.76.
Its throughput changes little with depth and p99 worsens. There is no old-driver
control in these samples: depth 1 uses the new reader seam too. Earlier lighter
and pre-lifecycle-fix cohorts are retained with their exact load, code and clock
method in [measurements.json](./measurements.json); no best-of selection is made.

## Checks and disposition

| Check | Result |
| --- | --- |
| Workspace build on rebased code | pass |
| Full default core | 1,138 top-level passes across 47 targets, five named ignores |
| Affected source census after PG-only lifecycle fixes | pass, 10 tests |
| Full binary on rebased code | pass, 586 tests / 49 named ignores |
| Both unchanged RT0 ratchets and publication cuts | pass, five tests |
| Reader transport and closure oracles | pass, 5 + 11 real tests |
| Unmodified lost-ack and public-startup fixtures via owned Unix socket | pass, one test each |
| Full stock Postgres sweep | completes, exit 1; three original failures below |
| ref-check on rebased code | pass, 567 LLPs, zero errors/unchecked |

The full default-core run precedes the PG-only lifecycle refinements; its
runtime module excludes that feature. Its affected source census and the
full binary, RT0, transport, closure and startup checks run again on the
rebased final code. RT0 warm PG W1/W2/W3 remains **1/1/1**, SQLite **5/5/132**;
both tables are byte-identical to the requested base. Exact per-class counts,
commands, durations and digests are in [qualification.json](./qualification.json).

The completed stock sweep retains the existing evaluator Serializable stress
failure, SQLSTATE 40001 at conformance.rs:294/join:307 (21 passes, one failure,
three existing filtered cases, 705.26 seconds). Its body is unchanged from the base;
no retry, backoff, workload, timeout, durability or exclusion is changed, and
no isolated retry replaces that red. The existing
[stress ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
records this occurrence. Two other original failures are fixture input
mismatches: the lost-commit-acknowledgement fixture explicitly requires a
private Unix socket; the public-startup fixture correctly rejects the TCP
evaluation URL under its Unix-only public profile. Both unchanged fixtures
pass on this same owned cluster through its socket. The product profile
guard and writer lost-ack behavior are intact.

Other stock stages pass, including 245 main adapter tests, codec/fault,
evolution/authority groups, supported corpus and differential/store
campaigns, and public deploy/serve/P1-CE/P1-MC milestones. An earlier script
attempt was cancelled after compilation warm-up to remove an inherited
undefined refresh helper; it supplies no qualification. The landing base
independently contains the same correction. All three separate experiment
lockfiles resolve with --locked without any package version changes.

## Owned cleanup

Primary PG16 master **1720724**: stop 0, independent status 3, no pid file and
no /proc identity. Public-witness master **2122589**: independently status 3,
no pid file and no /proc identity. The final socket recheck restarts only
the same owned data directory as master **2304069**;
its stop also returns 0, independent status is 3, and both PID-file and
/proc checks confirm absence. Data and raw evidence stay outside Git.
The audit finds all **508 recorded process identities**,
**541 public PID records** and **6 traced child PIDs** absent.
Exact target/data-directory scans find no survivors. **PIDs left: none.**

The 40 GiB outer disk stop never triggers; minimum sampled free space is
46.42 GiB. Only 14 newly created, unlocked incremental
cache sessions were removed to retain headroom; no pre-existing caches,
binaries or database data were deleted. Final free space is
94.27 GiB. No q24 files or processes were touched.

## Commits after the updated landing base

- `b5ef5a69b5` Pipeline independent Postgres reader statements with isolated snapshots
- `e7b0518559` Sync independent Postgres harness locks for reader transport
- `d1efedd953` Witness fresh authority after a failed pipelined collector
- `99f5373cd6` Remove obsolete shared-target refresh from Postgres sweep
- `8d31e1e5c4` Reclaim retired reader preparations on pooled connections
- `41090b215f` Recover closed reader sockets before future requests with binding checks
- `e295340912` Measure 128-client HTTP reads with a common load window
- `4ca669e894` Checkpoint PIPE measurements and retained sweep findings
