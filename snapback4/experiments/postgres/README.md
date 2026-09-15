# Postgres evaluation prototype

Working experiment, not a production backend or a new CLI/deploy option.
The existing Quarry interpreter now runs against a real Postgres database,
with transactional sync records and the existing local device. SQLite remains
the shipped backend. The author commissioned this bounded evaluation on
2026-09-15; [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
records the scope.

The first result is useful: **the application semantics can be shared, but
the row-at-a-time storage boundary is an expensive boundary for Postgres.**
The 32-room inbox issues 68 database calls. A separate native SQL join shows
substantial planning headroom; it does not yet implement Snapback's general
authorization, metering or completeness contract. A single sync commit head
also limits concurrent writers, including writers touching disjoint rows.

## What runs

Enable `snapback4-core`'s optional `postgres` feature and use
`engine::postgres::PostgresEngine::{create,open}` with a configured
`postgres::Client` and an isolated `sb4_eval_*` schema. `create` refuses an
existing namespace. `open` reads the persisted compiled schema and programs;
they are immutable in this prototype. The engine accepts trusted host contexts,
just like the SQLite `Engine`; this is not an authenticated service endpoint.

- Real compiled Quarry queries/mutations through the unchanged `Runner`:
  rules, index reads, ordered cursors, meter cuts, constraints, defaults and maintains.
- Canonical row images and ordered binary index keys in Postgres `r`/`i`
  tables. This is the initial adapter baseline, not per-application relational DDL.
- One transaction for rows, index changes, maintained values, commit head,
  partition events, emitted-effect records and durable operation receipts.
  A refused program rolls back its savepoint but commits a sanitized receipt;
  a database error rolls back everything. Replay never returns old result rows.
- Shared `partition::PartitionRows` interface beneath the existing snapshot,
  stream, join, revoke and current-row reauthorization algorithms; SQLite uses
  the same interface. Each query/snapshot/stream call sees a repeatable-read
  transaction, including its commit watermark. Paged acquisition retains the
  existing snapshot/catch-up protocol, not a long-lived database snapshot.
- Serialized writes reserve the head before reading, analogous to SQLite's
  writer. Experimental serializable writes execute concurrently and retry the
  entire operation on `40001`/`40P01`, or a duplicate receipt race, at most 32
  retries with backoff. All successful writes still update one commit head.
  `nextval()` is deliberately not used: allocation order is not commit order.
- Cached prepared statements per connection and explicit database-call/retry
  counters. Call counts include cold prepares/control statements, but omit
  implicit rollback on an error; they are not packet counts or resource limits.

The optional feature currently includes `sqlite` for shared server types.
It is not enabled by the CLI or device build; the harness has its own Cargo
workspace and lockfile so normal workspace tests do not require Postgres.

## Run it

From `snapback4/`, with Rust and PostgreSQL 16+ (`initdb`, `pg_ctl`) on PATH:

```sh
bash scripts/test-postgres.sh
bash scripts/test-postgres.sh --bench
```

The script creates a private temporary, Unix-socket-only database with host
connections rejected, runs every evaluation test (including ignored tests),
then stops only that cluster. It retains the database and prints its path for
inspection. It does not discover, modify or stop a pre-existing database.
The benchmark also retains its separate temporary SQLite database.

Alternatively set `SNAPBACK4_EVAL_POSTGRES` to a connection string for a local
throwaway database. The harness uses `NoTls`; do not point it at production or
a remote service. It creates fresh random `sb4_eval_*` schemas and never drops
them. The role needs schema-creation permission. For example:

```sh
export SNAPBACK4_EVAL_POSTGRES='host=/path/to/private/socket port=55439 user=sb4_eval dbname=postgres'
bash scripts/test-postgres.sh --bench
```

`SNAPBACK4_EVAL_ITERATIONS=1000` changes the timed iterations; 20 warm-up
operations precede each latency measurement. `SNAPBACK4_EVAL_OUTPUT` names a
**new** JSON result file; the executable refuses to overwrite an existing one.
Without it results go to stdout. Omit the database variable to use the script's
private cluster. Tests fail if explicitly run without a reachable database;
they never report missing infrastructure as a pass.

## Measurements, 2026-09-15

Recorded local release-build runs: [200 iterations](./results-20260915.json) and
[1,000 iterations](./results-20260915-repeat.json). Postgres 16.14, bundled
SQLite 3.53.2, Apple M5 / 32 GiB / macOS 26.6.2, Unix socket, 32 rooms × 25 items, plus
memberships, maintained totals and eight counters. These are small warm
engine-level measurements, with no HTTP, TLS, auth-session lookup, pooling,
WAN latency, production compiler tuning or controlled machine isolation.

The table uses the 1,000-iteration run's median latency:

| Workload | SQLite | Postgres adapter | Postgres calls/op |
| --- | ---: | ---: | ---: |
| Rule-filtered point read | 0.0057 ms | 0.117 ms | 5 |
| Ordered 20-row page | 0.0248 ms | 0.164 ms | 5 |
| 32-room inbox with maintained totals | 0.138 ms | 1.894 ms | 68 |
| Increment, receipt and sync commit | 0.054 ms | 0.441 ms | ~18 |

The separately hand-written relational inbox join measured **0.082 ms**
median, including its read transaction and result decoding. It returns the
same fixture values but intentionally omits general Snapback rules, metering,
dependency tracking and completeness/cursor semantics. It reads separately
seeded native tables with precomputed totals, not the adapter's application
tables; their updates are not connected to Quarry or sync. Its recorded
`EXPLAIN ANALYZE` uses a hash join. This is a query-planning lower bound, **not
an optimized Snapback implementation or an apples-to-apples backend ranking**.

With four writers and 2,000 total increment operations per cell:

| Postgres mode | Same counter | Disjoint counters | Retries, same / disjoint |
| --- | ---: | ---: | ---: |
| Serialized | 2,532 ops/s | 2,624 ops/s | 0 / 0 |
| Serializable | 2,217 ops/s | 2,182 ops/s | 874 / 984 |

SQLite measured 14,429 / 15,479 ops/s in those cells. Results are sensitive to
workload length and contention: the shorter run measured 4,693 / 7,825 on
SQLite and 1,816–2,351 on Postgres. The durable settings were SQLite WAL +
`synchronous=FULL` (not macOS `fullfsync`) and Postgres `fsync`,
`synchronous_commit`, `full_page_writes` on. These settings do not establish
identical power-loss guarantees. The concurrency timer includes worker
readiness/connection setup; latency samples exclude connection setup. There
is no crash, network or sustained-load qualification in these numbers.

## Evidence and boundaries

`scripts/test-postgres.sh`: **10 tests passed**, including one explicit
non-portability counterexample, not ten universal conformance claims:

- Matching SQLite results, receipt states and meters for the fixture's
  queries/mutations; pagination, authorization, defaults, maintains, rollback,
  reconnect/replay, and an examined-row cap.
- Late database failure after log/effect writes leaves no partial rows,
  indexes, commit, log, outbox or receipt. Application refusal retains only
  its refusal receipt. Concurrent duplicate refused writes retain one receipt.
- Four writers in each mode lose no increments and apply repeated op IDs
  once. Concurrent query/snapshot readers see matching rows and watermarks.
- Paged snapshots and whole-commit stream pages match SQLite across leave,
  writes while absent and rejoin.
- The existing memory-hosted device acquires Postgres pages, answers locally,
  predicts and durably queues offline, reopens from host-persisted changes,
  resends after response loss/server reconnect, settles from sync, and removes
  revoked rows. This invokes the real device through wire-shaped pages; it is
  not a browser/IndexedDB, HTTP host or iOS qualification.
- A 6,000-byte incompressible indexed text is accepted by SQLite but hits
  Postgres's B-tree tuple limit (`54000`). The adapter rolls it back atomically.
  **The generic BYTEA B-tree layout is not portable across the full existing
  schema domain.** It needs an alternative representation or an explicit
  admission restriction before product support; retrying will not fix it.

Not implemented: a PostgreSQL CLI/deploy target, migration/activation,
backup/restore or store-incarnation wire identity, an auth/session host,
subscriptions/HTTP invalidation, shared presence, asset storage, native module
execution, jobs, actions, effect-worker leases/delivery, RLS/SQL application
access, extensions, relational schema generation, pooling or async execution.
Assets/native/jobs/actions/schedules are explicitly refused at creation.
Effects can be recorded but never executed by this host. Logical expiry reads
reuse the interpreter, but no expiry sweep worker is provided or qualified.
The query meter measures interpreter work, not all Postgres physical work;
5-second SQL/lock timeouts are a guardrail, not a complete resource model.

## What to evaluate next

1. A plan-oriented execution boundary for bounded pages, related-row batches,
   and aggregates, retaining rule/meter/completeness semantics on both stores.
   The measured 68-call inbox is a concrete first target.
2. A commit-order design that does not serialize every successful transaction
   on one head, with adversarial delayed-commit/reconnect sync tests. Per-scope
   logs or a commit-ordered publication stage are options to investigate, not
   decisions made here.
3. A relational physical layout and an explicit server-only capability API,
   with a decision for large keys and externally authored writes. Raw SQL writes
   cannot silently bypass maintained values, receipts or sync logs.

This prototype supports keeping the application API database-agnostic. It does
not support freezing `Rows` as the complete backend abstraction, replacing
SQLite by default, or claiming an advantage over Convex/Supabase yet.
