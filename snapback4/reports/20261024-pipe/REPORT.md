# PIPE: independent PostgreSQL reader statements

Base: `bd50485b8c9ba1048ba7ed905b64444e219aeec6`, branch `sb4-pg/pipe`,
expo-build-450a. Own `snapback4/target`, six Cargo jobs, line-tables-only
dev/test profiles. Private PostgreSQL 16, no existing cluster or host workload
modified. Raw evidence is retained externally under `/tmp/sb4-pipe`.

The governing context is LLP 3000, the store-port §8, round-trip §3.6 and
§13, and accepted controls RFC §12. The author's M1b evidence explains the
S1b stall with Nagle and its removal with TCP_NODELAY. The M-suite branch
was unavailable from this lane's origin; it is treated as supplied evidence.

Detached reader handles share at most 30 physical connections, opened lazily.
Each has a depth semaphore (1–8, default 4). The one reader runtime I/O
thread drives tokio-postgres 0.7.18; synchronous request threads await their
own result. Parse/Bind/Execute/Sync sends one single statement per flight,
with an independent implicit transaction and snapshot for each request.
Statements return ordinary driver binary rows through the existing FromSql
path. G4a calls the same bounded facts SQL, decoder, Rust resolver and meter.
The typed literal encoder still checks all composed parameters, including
NUL and byte admission. No result or authority decision is cached.

A multi-statement read acquires exclusive physical-connection custody before
its first preparation/command and holds it through rollback. It keeps the
existing repeatable-read transaction and ordered SimpleQuery flights. Pipeline
reads cannot join that transaction. A speculative SQL failure can reopen the
ordinary snapshot, as G4a requires; a connection failure returns a retryable
error without adapter replay. Completed requests retain their results.
Closed slots are replaced only for a later handle, never an in-flight request.

The writer and lease keep their synchronous driver and commit ordering.
Both drivers use tokio-postgres's TCP socket connector, which sets
TCP_NODELAY before startup. Reader startup pins and verifies UTF8,
extra_float_digits=3, bytea_output=hex, read-only mode and backend affinity.
The shared settings guard remains on every fallback flight. Application SQL
cannot mutate reader connection settings through the independent seam.

HTTP retains its existing 30 executing short workers and 98 waiting sockets.
The manual benchmark instead supplies 128 concurrent core-query clients to
show the transport at depth 1/4/8. It includes authority, collection, Rust
execution and result serialization; it is neither a raw SQL ceiling nor an
HTTP S1 capacity/SLO qualification. The fixture has 34 memberships and three
messages per room; W2 and W3 use the actual scale-controls program shapes.
Measured loopback load and full qualification are recorded below when complete.

## Loopback measurements

Executed at `b5a0fb72bc` on Ryzen 5 3600 (6 cores/12 threads, affinity 12),
PostgreSQL 16.15, Rust/Cargo 1.97.0, test profile opt-level=1, debug
line-tables-only. Each operation/depth ran five seconds after a per-client
warm-up, 128 clients, at most 30 physical readers, one reader I/O thread.
This is a light populated shape (three messages per room), not S1's full
20-row W2 dataset. There is no proxy delay. No other lane-owned benchmark
or build ran during these samples.

| Depth | W2 reads/s | W2 p50 / p99 ms | W3 reads/s | W3 p50 / p99 ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5,198 | 24.04 / 39.33 | 2,299 | 54.64 / 85.07 |
| 4 | 5,295 | 22.57 / 63.28 | 2,289 | 54.16 / 119.90 |
| 8 | 5,243 | 22.85 / 61.83 | 2,316 | 53.62 / 118.57 |

The before/after one-minute host load averages were 2.96/7.47 at depth 1,
7.47/12.42 at depth 4 and 12.42/17.53 at depth 8; each includes this lane's
128-client load and the shared host. The longer averages and exact counts,
durations and percentiles are in [measurements.json](./measurements.json).
This loopback sample shows no material throughput gain with depth and worse
p99 beyond depth 1. It establishes neither the delayed-link benefit M1b
predicts nor a production throughput regression against the old synchronous
transport: depth 1 uses the same new driver seam and is not that old-driver
control. Delayed-link HTTP qualification and any admission change remain
separate measured work.

## Qualification checkpoint before final rebase

The initial full build passes. Full default core passes 1,138 top-level tests
across 47 targets (including doctests), with five named ignores. The full
binary passes 586 tests with 48 named ignores. Both unchanged RT0 tables
pass, including warm PG W1/W2/W3 = 1/1/1 and SQLite = 5/5/132.

The corrected full Postgres script completes in 3,774.09 seconds, exit 1.
It retains the tracked evaluator `40001` stress failure (21 conformance
passes / one failure / three existing filtered cases), and a public-startup
fixture input mismatch: its public binding correctly rejects the ambient TCP
evaluation URL with `connection-tls`. The unmodified startup fixture will be
rerun through this same owned cluster's Unix socket. Public deploy/serve,
P1-CE and P1-MC milestones pass; its separate cluster confirms status 3 and
no postmaster.pid. No writer retry, exclusion or durability change.

The landing base advanced to `480f88e8b4` with exactly the row-wrapper and
obsolete-helper corrections already present here. Final rebase, lifecycle
checks, current-revision measurements and owned-cluster cleanup follow.
