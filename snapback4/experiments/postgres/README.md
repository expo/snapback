# Postgres evaluation prototype

Working experiment, not a production backend or a new CLI/deploy option.
The existing Quarry interpreter now runs against a real Postgres database,
with transactional sync records and the existing local device. SQLite remains
the shipped backend. The author commissioned this bounded evaluation on
2026-09-15; [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
records the scope.

The first result is useful: **the application semantics can be shared, but
the row-at-a-time storage boundary is an expensive boundary for Postgres.**
The baseline 32-room inbox issues 68 database calls (C1 reduces this to 8). A separate native SQL join shows
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

For a same-host comparison, run the benchmark serially with
`SNAPBACK4_EVAL_PREFETCH=on` (the default) and `SNAPBACK4_EVAL_PREFETCH=off`,
using a different output path for each run. This changes only prefetch in the
measured Postgres engines; durability, workloads and retry limits are unchanged.
The JSON records the setting. The conformance tests still exercise both modes.

## C1 access boundary, 2026-09-15

C1 keeps Quarry in the same interpreter. The runtime page plan records total
row-field, literal, viewer and immutable argument/alias keys, plus rule probes
whose terms are pinned by those keys. It supports direct page loops and loops
over page-derived arrays, including inline helper aliases. Expiring tables and
maintains over expiring sources, filters, word lanes, merges, recurse and
non-total keys are excluded. There is no serialized IR or wire change.

After a page is read, Postgres batches exact gets by table and exact lookups by
(table, index). Lookups use the shared range bounds and one ordered lateral
limit-1 seek per key. The transaction owns positive and negative answers;
rows and cache-entry overhead have a **4 MiB** budget (`PREFETCH_ROW_BYTES`).
A fill uses a savepoint. SQL guards each group with the sum of serialized
payload byte lengths before returning any row images; a conservative 32×
decoding reserve and exact heap accounting keep it within the remaining
budget. An error or skipped group leaves earlier cache contents unchanged. Writes invalidate their table; program savepoint rollback
(including conflict reread), transaction rollback and commit discard the
appropriate cache. The interpreter still performs every rule and meter charge.
`PostgresEngine::set_prefetch(false)` disables both planning and filling.
SQLite and device `Rows` use the default no-op and do not build a prefetch plan.
Tiny batches unable to amortize the named two-call savepoint cost are skipped;
only distinct, uncached, fillable keys count. Tests cover three versus four
keys, duplicates, and already cached keys.

The tail reserves the sequence returned by the serialized head lock, then
sends the head update, commit record, all coalesced log rows and outbox rows in
one data-modifying CTE with parallel `unnest` arrays. Program-time row, index
and maintain writes remain immediate. The synchronous driver's protected
`_ops` receipt writer remains unchanged as the following call; COMMIT follows.
Thus this is one batched bookkeeping flight plus the existing receipt and
commit calls, **not one flight including the receipt**. Failure at any of
these stages rolls back the transaction, including the staged tail.

### Portable key measurement

The private script-owned cluster reported PostgreSQL **16.14 (Homebrew)**,
`block_size=8192`. On the prototype's unchanged `i` primary key `(t, ix, k)`,
with `t='items'`, `ix='byRoomTitle'`, an incompressible **2,672-byte** encoded
key succeeds; **2,673 bytes** fails with `54000`. The measurement binary
searches encoded nonzero pseudorandom bytes plus an id, avoiding a misleading
TOAST compression win. See `tests/key_limit.rs` and rerun with the ordinary
`bash scripts/test-postgres.sh` command. The physical boundary also includes
the table/index labels, so it is not a universal maximum for arbitrary names.

`MAX_INDEX_KEY_BYTES` is **2,048 bytes**, leaving **624 bytes** against that
measured case. Because the labels also occupy the B-tree tuple, table and
index names together have a 512-byte UTF-8 limit (`MAX_INDEX_LABEL_BYTES`),
checked with the same refusal on both stores. This closes the otherwise
unbounded identifier-size hole in the safety margin. `check` accounts for components, tags, terminators, worst-case
UTF-8 text (four bytes per character), zero-escaping of bytes, and the appended
row identity (138 encoded bytes under the existing identity bound). It checks
composite, word and contribution indexes. `E_INDEX_KEY_BYTES` names an
oversized column and a `<=N` rewrite. Every store, including the browser's MemoryStore, prepares and checks the
same keys once before a put changes anything. New oversized entries refuse;
existing oversized entries may remain equal or shrink, and deletes always
remain available. Longest-first matching also prevents a word index from
increasing its count of oversized entries. SQLite adoption and existing
Postgres open use one bounded-result query to report an offending table,
index and exact entry count with the rewrite; fresh stores skip this scan.
The declaration gate at `check`/source adoption remains primary. The old
6,000-byte counterexample asserts the same refusal for fresh writes on both
stores; browser/server boundary tests admit exactly 2,048 bytes and refuse
the next byte without partial writes. Legacy-image tests exercise cleanup.

The existing shared tokenizer already truncates indexed tokens and query
terms to **64 Unicode characters**, at most **256 UTF-8 bytes** after folding.
C1 reuses that contract, exposes its byte bound for the binder and documents
query truncation on the search card. No tokenizer or value-model version
changes. No schema under apps, fixtures, corpus, guide cards, the package
README or this experiment's fixture needed an edit. A declaration audit found
the corpus's largest composite at 1,303 bytes (`messages.byToken`).

### Differential evidence and bounded speculative calls

Complete `QueryOutcome` and `MutationOutcome` comparisons include all values,
completeness, cursors, cut sites, word cuts, every meter field, dependency tables,
next expiry and refusal sites. Tests cover fixture queries, hidden viewers,
all integer remaining-budget positions on all seven meters, early cuts,
expiring maintains, helper/derived-page reads, writes after prefetch, conflict
rollback rereads and payloads beyond the cache budget. Low-level tests cover
misses, gets, nonunique lookup order, null keys, invalidation and failed fills.
Oversized get and lookup pages assert **zero transferred row images/bytes**.

Every differential query and mutation asserts `calls_on <= calls_off +
marked_reads_for_the_largest_page + 4`, including cold prepares, the forced-cut
matrix, the byte-budget test and the write matrix. Warm fixture queries also
retain their stricter non-increasing-call assertion. The four-call allowance
covers control/prepare overhead; the page allowance admits speculative work
before a meter cut, as LLP 3000.009 §4.2 permits. The evaluation counters report
marked reads, the largest marked page, and transferred prefetch rows/bytes.
The fix-round report records the largest observed excess and suite totals.

The marking walk covers check-current reads, write targets, condition values
and condition setup; assignments inside setup disqualify an immutable alias.
Program rollback uses `rollback_program`, which clears cached answers before
conflict rereads. Generic `batch` rejects all case variants containing
`ROLLBACK`; speculative-only rollback retains earlier successful fills.

The corpus runs SQLite always and Postgres when the feature and
`SNAPBACK4_EVAL_POSTGRES` are present. Missing configuration or feature has a
named skip, never a pass. `scripts/test-postgres.sh` runs that leg inside its
private cluster. Assets/native/jobs/actions/schedules remain C3 exclusions.

## Measurements, 2026-09-15 — baseline

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

## Measurements, 2026-09-15 — C1

[C1 raw results](./results-20260915-c1.json), produced by:

```sh
SNAPBACK4_EVAL_ITERATIONS=1000 \
SNAPBACK4_EVAL_OUTPUT=experiments/postgres/results-20260915-c1.json \
bash scripts/test-postgres.sh --bench
```

The workload, iteration count, durability and timer are unchanged from the
1,000-iteration baseline. Other worktrees were running blocking suites on this
machine during C1's run; these are recorded observations, not an isolated
causal latency comparison. Even the native SQL lower bound increased from
81.7 to 349.9 microseconds. No benchmark parameters were tuned to the targets.

| Workload | SQLite median before → after, µs | Postgres median before → after, µs | Postgres calls/op before → after |
| --- | ---: | ---: | ---: |
| Point read | 5.7 → 15.7 | 116.9 → 468.5 | 5 → 5 |
| 20-row page | 24.8 → 57.4 | 164.2 → 898.3 | 5 → 5 |
| 32-room inbox | 137.6 → 344.0 | 1,894.1 → 2,234.4 | 68 → 8 |
| Increment | 54.0 → 188.3 | 441.2 → 2,509.0 | 18.002 → 15.002 |

The four-writer harness records aggregate throughput, calls and retries, but
does **not** collect per-operation latency samples; medians for these cells
are unavailable in both baseline and C1. With 2,000 mutations per cell:

| Four-writer cell | Ops/s before → after | Postgres calls/op before → after | Retries before → after |
| --- | ---: | ---: | ---: |
| SQLite, same counter | 14,429 → 4,282 | not instrumented | — |
| SQLite, disjoint counters | 15,479 → 4,363 | not instrumented | — |
| Postgres serialized, same counter | 2,532 → 305 | 18.018 → 15.012 | 0 → 0 |
| Postgres serialized, disjoint counters | 2,624 → 409 | 18.018 → 15.012 | 0 → 0 |
| Postgres serializable, same counter | 2,217 → 344 | 20.512 → 27.056 | 874 → 3,011 |
| Postgres serializable, disjoint counters | 2,182 → 355 | 21.936 → 28.832 | 984 → 2,764 |

**Both provisional targets are missed.** Page and inbox medians are 15.7×
and 6.5× the same-run SQLite medians (target ≤3×); serialized commits reach
305–409/s (target ≥5,000/s). Inbox calls fell by 60 and serialized mutation
calls by three, but this run does not establish a latency or throughput win.
Serializable retries increased; the result is preserved without retuning.

## Fix-round idle measurement, 2026-09-15

The duplicate `stored_index_keys` computation was removed. All puts now
prepare and validate their old/new entries once and reuse those entries for
the physical write, including word indexes. This fixes an actual added cost;
the earlier regression is not attributed to load.

[Raw SQLite measurements](./results-20260915-c1-fix-idle-sqlite.json) use the
unchanged fixture and timing/writer functions via a new `--sqlite-only`
selection in the existing benchmark. The machine was `expo-build-450b`
(`expose-builder-pixel-a`), AMD Ryzen 5 3600, 12 logical CPUs, 128 GiB RAM,
Ubuntu 24.04, NVMe storage, Rust 1.94.0, Node 24.13.1, SQLite 3.53.2.
`vmstat` showed 98–100% CPU idle immediately before and 100% after, no swap
traffic, and no other build/test workload. It used release builds, WAL/FULL,
32 rooms × 25 items, 20 point-read warmups, **200** timed reads and **400**
mutations per four-writer cell.

| SQLite cell | Fix round, idle Linux |
| --- | ---: |
| Point read median / p95 | 14.748 / 15.319 µs |
| Four writers, same counter | 162.68 ops/s |
| Four writers, disjoint counters | 158.51 ops/s |

Command: `SNAPBACK4_EVAL_OUTPUT=<new-file> cargo run --locked --release
--manifest-path experiments/postgres/Cargo.toml -- 200 --sqlite-only`.
The flag selects these cells without requiring a Postgres database; it changes
no timings, fixture data, SQLite settings, or writer implementation.

Two full 1,000-iteration attempts on that idle host stopped at SQLite's
existing five-second busy timeout; the default 200-iteration combined run
then exhausted Postgres's existing serializable retry budget. Neither is a
successful performance result. The focused run completed both SQLite cells
and verified their final counter values. Timeout/retry limits and durability
were not raised. The different platform and shorter run make these numbers
**unsuitable for a causal before/after comparison with the original M5 run**;
no throughput recovery or performance-target success is claimed.

## Evidence and boundaries

The original pre-review C1 `bash scripts/test-postgres.sh` run passed: **15 conformance,
1 device, 2 key-limit and 2 cache tests**, plus **18 corpus tests**. The corpus
reports SQLite **211 passed / 83 skipped / 0 failed** and Postgres
**208 passed / 86 skipped**. The two extra portable-bound measurements admit
the exact 2,048-byte boundary and that boundary alongside 512 bytes of names.
The full workspace/client qualification, changed-file list and explicit
deviations are in [the C1 report](./C1-REPORT.md). Performance targets remain
missed as recorded above.

The pre-C1 `scripts/test-postgres.sh` baseline: **10 tests passed**, including one explicit
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
- In the pre-C1 baseline, a 6,000-byte incompressible indexed text is accepted by SQLite but hits
  Postgres's B-tree tuple limit (`54000`). The adapter rolls it back atomically.
  **The generic BYTEA B-tree layout is not portable across the full existing
  schema domain.** It needs an alternative representation or an explicit
  admission restriction before product support; retrying will not fix it.
  C1 resolves this case with the portable admission/write bound above.

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
   C1's eight-call inbox still misses the latency target in the recorded run.
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
