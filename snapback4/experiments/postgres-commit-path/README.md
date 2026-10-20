# S0: commit-path cells (Postgres and SQLite)

Working measurement experiment for the committer decision, not a product
benchmark. It feeds:

- [LLP 3000.009.001 §3.3](../../../llp/3000.009.001-snapback4-on-postgres.rfc.md)
  (the commit path is the first scale risk);
- [LLP 3000.009.001.000 §6](../../../llp/3000.009.001.000-the-postgres-store-port.rfc.md)
  (the committer candidates: the reference, (0) the serial batch, (a) the
  optimistic committer and its batch commit stage);
- [LLP 3000.009.001.002](../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md)
  §3 (H1), §8 (the first decision rule) and §9 (S0).

Nothing under `crates/` was changed. The harness has its own Cargo workspace
and depends on `snapback4-core` (feature `postgres`) and on
[`../postgres`](../postgres/README.md) (its fixture, `compiled()`, `context()`)
by path.

## Summary

Pass 2 is the full matrix, run at host load 20–130. Pass 3 reran the 0.5 ms
cells at load 4–9 and agrees within about 10%.

| Cell (commits/s, median of 3; writers) | unix | proxy 0 | 0.2 ms | 0.5 ms | 1.0 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1. Real engine, reference committer (4, disjoint) | 988 | 463 | 216 | **120** | 69 |
| 2R. Model of the reference (4, disjoint) | 1,339 | 605 | 236 | 126 | 69 |
| 2(0). MODEL serial batch, best N (2N writers, disjoint) | 2,336 (N=8) | 821 (N=64) | 295 (N=8) | **160** (N=32) | 85 (N=32/64) |
| 2(0). same, coalesced tail, best N | | | | 192–203 (N=64) | |
| 2(A). UPPER BOUND commit stage of (a), N=64 (128, disjoint) | 41,500 | 36,799 | 27,232 | **15,744** | 11,424 |
| 3. Raw Postgres, autocommit UPDATE (4, disjoint) | 39,770 | 23,774 | 11,183 | **5,705** | 3,209 |
| 3. Raw Postgres (64, disjoint) | 316,893 | 237,339 | 136,996 | 88,842 | 49,310 |
| 3. Raw Postgres (64, same row) | 8,080 | 7,247 | 7,668 | 8,164 | 7,599 |

SQLite (cell 4, `serve` topology, one connection behind a mutex): 3,660–4,036
commits/s at 4, 16 and 64 client threads (4,045–4,240 in pass 3), flat in
writers and in disjointness.

**The first decision rule fires.** At 0.5 ms RTT the serial batch (0) reaches
at most 160 commits/s with today's per-member statements (about 200/s with a
coalesced tail). That is 149/s in the quieter pass 3. It is 5–7× below
1,000 commits/s, and at about 3% of raw Postgres with four writers (5,705/s)
it is about 9× below the 25% line.
See [What this says for the decision rule](#what-this-says-for-the-decision-rule).

The full matrix is in [Results](#results) and the raw JSON lines are in the
`results-20261019-*` directories.

## Environment

| | |
| --- | --- |
| Host | `expose-builder-pixel`, AMD EPYC 9454 48-core (96 logical CPUs, 1 socket, 1 NUMA node), 251 GiB RAM, Ubuntu 24.04, Linux 6.8.0-142 |
| Storage | ext4 on `/dev/nvme0n1p4`, KIOXIA KCD8XRUG1T92 datacenter NVMe ([host.txt](./results-20261019-pass1/host.txt)) |
| `pg_test_fsync` (2 s per test, data-dir filesystem) | fdatasync **49,887 ops/s, 20 µs/op** (one 8 kB write); open_datasync 16 µs ([full output](./results-20261019-pass1/pg_test_fsync.txt)) |
| PostgreSQL | 16.15 (Ubuntu build) from `~/tools/pg16`, a private cluster started by `scripts/cluster.sh`: `fsync=on`, `synchronous_commit=on`, `full_page_writes=on`, `wal_sync_method=fdatasync`, `commit_delay=0`, default `shared_buffers` (128 MB), `max_connections=200`, `pg_stat_statements` loaded, Unix socket in a short `/tmp/sbpgXXXX` dir, TCP on 127.0.0.1 only |
| SQLite | 3.53.2 (bundled), production `Store::open`: WAL, `synchronous=FULL` (verified with `PRAGMA` in every result) |
| Rust | 1.97.0, release profile |
| Engine | `PostgresEngine` (layout `snapback4-postgres-evaluation-3`) at base `3c7c10a9f4`, `WriteMode::Serialized`, prefetch on (the default) |

**Host load.** Other agents were running builds and suites on this host
throughout. The 1-minute load average was 92 when the ping block started
(170–215 shortly before), fell to 20–50 during most Postgres blocks, rose to
~130 during part of the (0) block at `rtt0`, and was 13–19 during the SQLite
block. Every result line records `loadavg_before`/`loadavg_after`, and
`vmstat.log` in each directory has `vmstat 1 5` before and after every block.
The brief asked to rerun a block whose load exceeded ~4. That was not
possible: the load never fell to 4 during the session. Instead
`results-20261019-pass3-rtt500` reruns the decision cells at 0.5 ms with the
gate at 8 when the load fell to 4–9
(see [Pass 3](#pass-3-rerun-of-the-decision-cells-at-lower-load)), and
`results-20261019-pass4-lowrtt` rechecks the low-RTT calibration.
Treat the unix-socket and zero-delay cells as noisy. Their run-to-run spread
is wide. At 0.2 ms and above, the network term dominates and the spread is a
few percent.

## Network settings and the delay proxy

There is no root, so `tc netem` is not available. `src/proxy.rs` is a
userspace TCP proxy in front of Postgres's 127.0.0.1 port. For each
connection and direction, a reader thread stamps every chunk it receives with
`arrival + RTT/2` and hands it to a writer thread in order. The writer waits
until that deadline and forwards the chunk. The writer sets a 1 ns timer
slack, sleeps until 100 µs before the deadline and spins the rest. Order is
preserved, and chunks pipeline.

Settings: `unix` (direct Unix socket, reference only), `tcp` (direct loopback,
ping only), `rtt0` (the proxy with zero delay, to measure its own overhead),
`rtt200`, `rtt500` and `rtt1000` (added RTT in µs).

Measured `SELECT 1` round trip, 5,000 pings after 200 warm-ups
([ping.jsonl](./results-20261019-pass1/ping.jsonl)):

| Setting | p50 µs | p90 µs | p99 µs | p50 minus proxy-0 p50 |
| --- | ---: | ---: | ---: | ---: |
| unix | 21.1–24.5 | 26–27 | 37–42 | — |
| tcp (no proxy) | 33.0 | 42.2 | 64.4 | — |
| proxy, 0 delay | 70.4 | 93.5 | 115.1 | 0 |
| proxy, 0.2 ms | 275.7 | 308.0 | 340.1 | 205 |
| proxy, 0.5 ms | 595.2 | 626.0 | 680.5 | 525 |
| proxy, 1.0 ms | 1,119.0 | 1,149.4 | 1,196.9 | 1,049 |

The proxy itself adds about 37 µs over direct TCP on a `SELECT 1`. Its
delay overshoots the setting by 2–5%.

On real statements the proxy costs more than on a ping. In the single-writer
calibration (pass 4), one increment's 18 statements take 0.83–0.99 ms over
direct TCP, about 50 µs per statement, and 2.8–2.9 ms through the
zero-delay proxy, about 155 µs per statement against its 56 µs ping. So every
proxied statement pays about 0.1 ms beyond the nominal setting. The cause was
not isolated; it may be thread wake-up per chunk under load. At the "0.5 ms"
setting, (0)'s per-member statements cost about 0.67 ms each (1/149 s ÷ 10).
These cells therefore **understate** what (0) and the reference would reach
at an exact 0.5 ms. Scaling by 0.5/0.67 gives about 200 commits/s for (0)
per-member and about 250/s coalesced. That is still far below 1,000/s, and
raw Postgres is understated by the same factor, so the ratio test is
unaffected.

## Cells and how to rerun them

Build once, start a private cluster, then run any cell. Each cell runs three
times (1 s warm-up, 4 s measured window; 6 s for the (0) block), and prints
one JSON line with every run, the median and the spread.

```sh
cd snapback4/experiments/postgres-commit-path
cargo build --release
export LD_LIBRARY_PATH=~/tools/pg16/usr/lib/x86_64-linux-gnu
ENV=$(scripts/cluster.sh start <scratch-dir> <free-port>)   # prints the env file path
source "$ENV"
B=target/release/snapback4-postgres-commit-path
```

| Cell | One command (one setting) | Whole block, as recorded |
| --- | --- | --- |
| RTT check | `$B ping --net rtt500` | `scripts/sweep.sh <new-dir> ping` |
| Statement capture | `$B capture` (log_statement=all on the engine's own session) | — |
| 1. Engine, reference | `$B engine --net rtt500 --counters disjoint --writers 4` | `scripts/sweep.sh <dir> engine` |
| 1. Single-writer calibration | `$B engine --net unix --counters disjoint --writers 1` and `$B model --protocol R --net unix --counters disjoint --writers 1` | `scripts/sweep.sh <dir> calibration-w1` |
| 2. Model R | `$B model --protocol R --net rtt500 --counters disjoint --writers 4` | `scripts/sweep.sh <dir> model-R` |
| 2. Model (0) | `CP_MEASURE_MS=6000 $B model --protocol 0 --batch 32 --net rtt500 --counters disjoint` (writers default to max(4, 2N); `--tail coalesced` for the coalesced variant) | `scripts/sweep.sh <dir> model-0`, `... model-0-coalesced` |
| 2. Commit stage (A) | `$B model --protocol A --batch 64 --net rtt500 --counters disjoint` (`--txn implicit` for the one-statement variant) | `scripts/sweep.sh <dir> model-A`, `... model-A-implicit` |
| 3. Raw Postgres | `$B raw --net rtt500 --writers 64 --counters disjoint` | `scripts/sweep.sh <dir> raw` |
| 4. SQLite, serve topology | `$B sqlite-serve --writers 16 --counters disjoint --dir <scratch>` | `SQLITE_DIR=<scratch> scripts/sweep.sh <dir> sqlite` |
| 4. Old four-connection cell | `$B sqlite-old-cell --counters disjoint --per-writer 100 --dir <scratch>` (verbatim `concurrent_sqlite`) and `$B sqlite-four-connections --counters disjoint --dir <scratch>` (same shape, this harness's timer) | `scripts/sweep.sh <dir> sqlite-old` |
| 5. SQLite exec/flush estimate | `$B sqlite-exec-flush --dir <scratch>` | in the `sqlite` block |
| Tables | `python3 -I scripts/tables.py <dir>`; H1 and calibration: `python3 -I scripts/analysis.py <dir> <ping.jsonl>` | |

`scripts/sweep.sh` refuses to overwrite an existing block file. It runs a
load gate before each invocation (wait up to `LOAD_WAIT_S` for the 1-minute
load to drop below `LOAD_MAX`; the waited seconds are recorded). It writes
`vmstat 1 5` before and after the block, and it keeps failed cells as
failures. Stop the cluster with `scripts/cluster.sh stop "$ENV"`.

Durability, retry limits and timeouts are untouched. The engine keeps its
own 5 s statement and lock timeouts and its 32-retry budget, which is never
reached in serialized mode. The model and raw sessions set the same 5 s
timeouts. SQLite keeps its 5 s busy timeout.

Every Postgres and SQLite cell checks for lost increments at the end: the sum
of the counters must equal the number of acknowledged increments over all
runs, warm-up included. Every recorded cell passed this check.

## The captured statement sequence

`$B capture` ran three increments with `log_statement=all` on the engine's own
session ([log](./results-20261019-pass1/capture-increment-statements.log)).
A warm increment makes **18 calls**, which matches `Stats::database_calls` in
every engine cell:

| # | Statement | Holds the head lock |
| ---: | --- | --- |
| 1 | `START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` (replay pre-check) | |
| 2 | `SELECT generation, (SELECT seq FROM _head …) FROM _backend` | |
| 3 | `SELECT outcome,name,args_digest FROM _ops WHERE principal=$1 AND id=$2` | |
| 4 | `ROLLBACK` | |
| 5 | `START TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE` | |
| 6 | `SELECT seq FROM _head WHERE singleton FOR UPDATE` | lock granted |
| 7 | `SELECT generation FROM _backend` | yes |
| 8 | `SELECT … FROM _ops …` (in-transaction receipt check) | yes |
| 9 | `SAVEPOINT program` | yes |
| 10–13 | scan size preflight + fetch on `i ⋈ r` (`counters`, `byId`, key range, limit 1), twice: the `!` read and the update's read | yes |
| 14 | `UPDATE r SET data=$3 WHERE t=$1 AND id=$2` (no index entry changes; `value` is not indexed) | yes |
| 15 | `RELEASE SAVEPOINT program` | yes |
| 16 | the tail CTE: head update, `_commits`, `_log` (1 row), `_outbox` (empty) | yes |
| 17 | `INSERT INTO _ops …` (receipt) | yes |
| 18 | `COMMIT` (flush) | released after the flush |

H1 counts k ≈ 15 calls per increment. The current code makes 18, but only
**12 round trips** are inside the serial section: from the grant at 6 to
COMMIT at 18. The four pre-check calls run outside the lock and overlap
with other writers.

`src/model.rs` replays this sequence with the same texts, parameter types and
values, against a namespace that the real engine created and seeded, so the
tables, indexes and constraints are the same.

## Results

### Cell 1 and the model calibration (cell 2R)

The real `PostgresEngine` in `WriteMode::Serialized`, four writers, each on its
own connection through the proxy ([engine.jsonl](./results-20261019-pass2/engine.jsonl),
[model-R.jsonl](./results-20261019-pass2/model-R.jsonl)):

| Setting | Engine disjoint | Engine same | Model R disjoint | Model R same | Model ÷ engine |
| --- | ---: | ---: | ---: | ---: | ---: |
| unix | 988 (657–1,048) | 976 (675–1,033) | 1,339 (827–1,415) | 1,010 (632–1,187) | 1.35 / 1.04 |
| proxy 0 | 463 (456–474) | 502 (441–545) | 605 (439–668) | 627 (424–716) | 1.31 / 1.25 |
| 0.2 ms | 216 (211–226) | 226 (218–227) | 236 (227–251) | 243 (229–244) | 1.10 / 1.08 |
| 0.5 ms | 120 (119–121) | 121 (120–123) | 126 (124–126) | 126 (124–126) | 1.04 / 1.04 |
| 1.0 ms | 69 (68–70) | 68 (67–68) | 69 (68–70) | 70 (69–70) | 1.01 / 1.03 |

Engine p50/p99 commit latency at 0.5 ms: 33.4/38.3 ms (disjoint) and
32.6/41.4 ms (same). Calls per op: 18.0 in every cell. WAL: 1,085–1,111 bytes
per commit.

Wait events sampled every 2 ms during the engine's 0.5 ms cells: of about
4 sessions per sample, 2.5 wait on `Lock:tuple`/`Lock:transactionid` (the
`_head` row lock), and 1.2 are `idle in transaction` on `ClientRead`. The
lock holder spends the serial section waiting for its own client's next
statement. CPU and WAL waits are negligible.

**Calibration.** The model reproduces the engine within 10% at every proxied
RTT of 0.2 ms and above (ratios 1.01–1.10), the settings the decision depends
on. At the Unix socket and the zero-delay proxy, pass 2 measured the model
25–35% faster than the engine, more than the brief's ~20%. Those cells are
noisy: the load was 25–60 and the model's run spread was wide (827–1,415 at
unix). Two follow-ups narrowed the gap:

- **Pass 4** reran them at load 9–14 ([pass 4](#pass-4-low-rtt-recheck)). The
  ratios became 1.10 and 1.25 at unix and 1.05 and 0.98 at the zero-delay
  proxy.
- **The single-writer calibration** (passes 3 and 4) has one writer, so no
  contention. The model is 4–7% faster per mutation over the Unix socket and
  direct TCP, and 3–15% faster through the zero-delay proxy.

The remaining gap is the engine's client-side work, which the model does not
do: Quarry interpretation, metering, prefetch planning, row decode and
encode, receipt JSON. The engine does this inside the lock. It costs about
0.04 ms per mutation on a Unix socket. Through the proxy it is noisier, up to
about 0.4 ms. At the Unix socket and the zero-delay proxy, the four-writer
gap is not fully explained, and it is recorded as unexplained rather than
forced to fit. The consequence for the decision is one-sided. The (0) model
omits this work, so it is **optimistic**, which cannot turn a fired rule into
a non-fired one. The (A) bound omits it deliberately.

Another effect touches the first run of every freshly created namespace,
for the engine and for every model protocol. A cell's first run is slower:
up to about 2,000 commits/s regardless of N for (A); 650–830/s at unix for
the reference and (0). The cause is the `_log → _commits` foreign-key check.
Its cached plan was made while `_commits` was nearly empty, so it seq-scans
`_commits` until autovacuum's next analyze invalidates the plan.
`pg_stat_user_tables` shows about 15,000 seq scans reading about 110 million
tuples of `_commits` in each (A) namespace. Runs 2 and 3 use new connections
and the replanned check. The reported median is therefore the slower of the
two warm runs, which is conservative. A fresh production store would see
this for its first autovacuum cycle. It is a side finding, not a commit-path
limit.

### H1: prediction vs measurement

H1 predicts `≤ 1/(k·RTT + exec + F)` with k ≈ 15. Taking `exec + F = 0` gives
the upper bound below. RTT is the measured ping p50, which includes the
proxy's own overhead.

| Setting | ping RTT | H1, k=15, exec+F=0 | Measured engine (disjoint / same) | Measured ÷ H1 |
| --- | ---: | ---: | ---: | ---: |
| unix | 0.021 ms | 3,167 | 988 / 976 | 0.31 |
| proxy 0 | 0.070 ms | 948 | 463 / 502 | 0.51 |
| 0.2 ms | 0.276 ms | 242 | 216 / 226 | 0.91 |
| 0.5 ms | 0.595 ms | 112 | 120 / 121 | 1.08 |
| 1.0 ms | 1.119 ms | 60 | 69 / 68 | 1.15 |

A least-squares fit over the eight proxied engine cells gives **serial ms per
commit = 2.05 + 11.98 × added RTT (ms)**. The slope is the number of round
trips inside the serial section, 12.0, exactly what the captured sequence
shows. The intercept is the serial time at the proxy's zero setting: proxy
overhead on 12 calls, server execution, the flush and the engine's client
work.

**H1 holds.** The reference committer is about 120 commits/s at 0.5 ms and
69/s at 1 ms. It is flat in writers' disjointness (disjoint and same counter
agree within 5% everywhere) and far below the falsifier of 1,000/s at 1 ms.
At 0.5 ms and above, k=15 with exec + F = 0 is a slightly pessimistic
estimate: the serial section holds 12 round trips plus about 1–2 ms of fixed
cost, not 15. Below 0.2 ms the fixed term dominates and H1's bound
over-predicts by 2–3×. H1 predicted about 450/s at a Unix socket from the
older M5 and Ryzen measurements. This host measured 988/s.

### Cell 2(0): the serial batch, MODEL

One committer thread drains up to N queued mutations and runs them in one
transaction: START; head FOR UPDATE; generation once. Then, for each member:
the receipt check, SAVEPOINT, the four reads, UPDATE r, RELEASE, the
member's tail (`_commits` + `_log`) and its `_ops` receipt. Then one head
update to the batch's last sequence, then COMMIT. That is 10 round trips per
member plus 5 per batch. Writers run the engine's replay pre-check (4 calls)
on their own connection, outside the serial section, then enqueue and wait.
Writers = max(4, 2N), so a full batch is always queued; the committer's batch
histogram is in each JSON line. [model-0.jsonl](./results-20261019-pass2/model-0.jsonl):

| N (writers) | unix | proxy 0 | 0.2 ms | 0.5 ms | 1.0 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 (4), disjoint / same | 1,370 / 1,152 | 610 / 586 | 208 / 196 | 89 / 94 | 57 / 57 |
| 2 (4) | 1,887 / 1,783 | 792 / 671 | 238 / 245 | 113 / 114 | 68 / 68 |
| 4 (8) | 1,748 / 1,868 | 531 / 595 | 277 / 263 | 130 / 125 | 76 / 76 |
| 8 (16) | 2,336 / 2,375 | 609 / 579 | 295 / 288 | 140 / 135 | 81 / 81 |
| 16 (32) | 2,216 / 2,147 | 541 / 666 | 293 / 280 | 141 / 152 | 83 / 83 |
| 32 (64) | 2,315 / 2,240 | 758 / 864 | 272 / 288 | **160** / 155 | 85 / 85 |
| 64 (128) | 2,197 / 2,229 | 821 / 992 | 277 / 267 | 149 / 160 | 85 / 85 |

Spreads and latencies are in the JSON and in `tables.py`'s detail output.
For example, at 0.5 ms and N=32 the spread is 155–160 commits/s, p50/p99
latency is 408/433 ms, there are 15 calls per op, and WAL is 918 bytes per
commit. The unix and proxy-0 columns ran at load 40–130, and their minimum
runs are 40–60% of the medians.

With the coalesced tail (each member's `_commits`, `_log` and `_ops` rows go
into one statement at the end, 8 round trips per member), the best 0.5 ms
values are **192/s (disjoint)** and **203/s (same)**, both at N=64
([model-0-coalesced.jsonl](./results-20261019-pass2/model-0-coalesced.jsonl)).

(0) saturates at about `1/(k_member·RTT)`: 10 × 0.6 ms → 165/s per-member,
8 × 0.6 ms → 205/s coalesced. Batching recovers only the flush and the
per-transaction calls. The flush costs about 20 µs on this host, so the
recovery is small: the best (0) is 1.3× the reference at 0.5 ms. At N=1 it
is 0.75× the reference, because a separate head update and the committer
handoff add per-batch cost. The 0.5 ms wait events show the committer `idle
in transaction` on `ClientRead` at almost every sample, so it is bound by
round trips, not by Postgres.

### Cell 2(A): commit stage of (a), UPPER BOUND

Execution, snapshot reads, read-set validation and conflict reruns are
**omitted by construction**. The committer folds each increment into an
in-memory head and knows the write sets. Per batch it runs START, then one
CTE that applies every member's `r` row image with `unnest` and writes the
head update and the `_commits`, `_log` and `_ops` rows, then COMMIT: three
round trips. Disjoint counters only. Under (a)'s serial validation, only one
increment of a given counter can enter a batch, so the same-counter (A)
bound is the N=1 row. [model-A.jsonl](./results-20261019-pass2/model-A.jsonl):

| N (writers) | unix | proxy 0 | 0.2 ms | 0.5 ms | 1.0 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 (4) | 2,257 | 1,712 | 761 | 424 | 251 |
| 2 (4) | 5,818 | 3,823 | 1,524 | 863 | 517 |
| 4 (8) | 9,570 | 7,818 | 2,947 | 1,687 | 1,026 |
| 8 (16) | 14,375 | 11,132 | 6,150 | 3,028 | 2,040 |
| 16 (32) | 24,188 | 18,892 | 9,632 | 5,496 | 3,840 |
| 32 (64) | 33,127 | 25,312 | 16,688 | 10,328 | 6,696 |
| 64 (128) | 41,500 | 36,799 | 27,232 | **15,744** | 11,424 |

This matches LLP 3000.009.001.000 §6.3's `batch / (2·RTT + flush)` shape with
3 round trips: 64 / (3 × 0.6 ms + ~2 ms) ≈ 16,000. The one-statement
`--txn implicit` variant (one round trip and the flush) reaches 32,304/s at
N=64 and 0.5 ms ([model-A-implicit.jsonl](./results-20261019-pass2/model-A-implicit.jsonl)).
WAL is about 900–920 bytes per commit. At this rate the bound is a
commit-stage ceiling. (a)'s throughput would instead be set by its
execution stage, `connections / (k·RTT + exec)`, which this cell does not
measure.

### Cell 3: raw Postgres control

A typed `counters(id text primary key, n bigint)` table, autocommit
`UPDATE … SET n = n + 1 WHERE id = $1`, one round trip per commit.
[raw.jsonl](./results-20261019-pass2/raw.jsonl):

| Writers, rows | unix | proxy 0 | 0.2 ms | 0.5 ms | 1.0 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4, disjoint | 39,770 | 23,774 | 11,183 | **5,705** | 3,209 |
| 4, same | 20,453 | 19,286 | 10,870 | 5,782 | 3,168 |
| 16, disjoint | 124,651 | 73,554 | 41,090 | 21,023 | 12,342 |
| 16, same | 14,368 | 9,562 | 8,728 | 9,078 | 9,292 |
| 64, disjoint | 316,893 | 237,339 | 136,996 | 88,842 | 49,310 |
| 64, same | 8,080 | 7,247 | 7,668 | 8,164 | 7,599 |

WAL is 115 bytes per commit on disjoint rows and 130–172 on one row. The
engine's increment writes about 1,100 bytes per commit, because it also
writes the `_commits`, `_log` and `_ops` rows. That is about 9.5× the raw
update, a data point for H5, which this experiment does not otherwise
measure. Disjoint writers
scale with writers and with 1/RTT. Same-row writers saturate at 7,000–9,000/s,
independent of RTT, because the row lock is held only across Postgres's own
flush and not across client round trips.

### Cell 4: SQLite under `serve`'s topology

One `Engine` (one connection, WAL, `synchronous=FULL`) behind a `Mutex`, as
`serve`'s `FairMutex<Engine>` (std's mutex is not FIFO-fair). Client threads
call `mutate("increment")` through it ([sqlite.jsonl](./results-20261019-pass2/sqlite.jsonl)),
load 16–19:

| Client threads | disjoint | same |
| ---: | ---: | ---: |
| 4 | 3,660 (3,567–3,786) | 3,986 (3,876–4,066) |
| 16 | 3,815 (3,727–3,938) | 3,839 (3,623–4,062) |
| 64 | 3,864 (3,827–3,938) | 4,036 (3,639–4,124) |

p50 is 0.22–0.24 ms and p99 is 0.62–0.71 ms (time inside `mutate`; queueing
on the mutex is included).

The old four-connection shape, in the same block:

- `sqlite-old-cell` is the verbatim `concurrent_sqlite`: count-based, 100 per
  writer, timer including worker readiness. It gave 3,047 (1,847–3,482) same
  and 2,555 (2,491–3,455) disjoint ([sqlite-old.jsonl](./results-20261019-pass2/sqlite-old.jsonl)).
  `experiments/postgres`'s own binary could not be used: its `Cargo.lock` is
  stale for `--locked` builds, and this experiment does not edit that
  directory.
- `sqlite-four-connections` is the same shape on this harness's timer. Same
  counter: 4,590 (4,373–4,700). Disjoint: **failed**. Two of three runs hit
  `SQLITE_BUSY` ("database is locked") after the unchanged 5 s busy timeout;
  the one complete run reached 4,121/s. The busy handler is also unfair. In
  a 4 s window, one connection committed 10,482 times while another
  committed 0.

**The 165/s premise.** On this host, four contending connections reach the
same or higher aggregate throughput as the single serialized connection
(about 3,000–4,800 against 3,700–4,200, passes 2 and 3), so this run **does not confirm** that the
old 165/s was a busy-handler throughput artifact. What the busy handler
does cause here is starvation and 5 s timeouts, which is still a reason not
to measure SQLite that way. The 165/s was measured on `450b` (Ryzen 5 3600,
consumer NVMe), which was not measured here. Its per-commit time of about
6 ms is consistent with a flush-bound commit on a drive without power-loss
protection, whereas this host's fdatasync costs 20 µs. That is a hypothesis.
Settling it needs `pg_test_fsync` and cell 4 on `450b`.

### Cell 5: SQLite serial-batch ESTIMATE

`Engine::mutate` opens its own `BEGIN IMMEDIATE`, and the core exposes no
way to run several mutations in one transaction from outside. A faithful
batch therefore cannot be built without modifying the core, so this cell is
an **estimate**. With one connection and one writer, the mean per-mutation
time is 158.1 µs at `synchronous=OFF` (exec) and 237.4 µs at `FULL`, so
flush = 79.3 µs. The predicted throughput is N/(N·exec + flush):

| N | Estimated commits/s | vs N=1 |
| ---: | ---: | ---: |
| 1 | 4,212 | 1.0× |
| 4 | 5,620 | 1.3× |
| 16 | 6,132 | 1.46× |
| 64 | 6,275 | 1.49× |

Exec at OFF still pays per-commit work that a real batch would amortize
(BEGIN/COMMIT, WAL frame writes, lock), so the estimate is conservative. On
this host the flush is only a third of a commit, so the second decision rule
("(0) on SQLite gains less than 3× over the reference at batch 16 → recheck
(0)'s implementation") would fire on this estimate. That rule's premise,
that the flush dominates, does not hold on a drive with power-loss
protection. On a host whose fsync costs milliseconds, it does.

### Pass 3: rerun of the decision cells at lower load

[`results-20261019-pass3-rtt500/`](./results-20261019-pass3-rtt500/) reruns
the 0.5 ms decision cells and the SQLite block after the host quieted. The
gate was load < 8, waiting up to 120 s. The 1-minute load during the
Postgres cells was 4–9, with three raw cells at 9–15, and 4–7 for SQLite.

| Cell at 0.5 ms (writers) | Pass 2 | Pass 3 |
| --- | ---: | ---: |
| Engine, reference (4) disjoint / same | 120 / 121 | 116 (116–116) / 117 (115–118) |
| (0) N=1 (4) | 89 / 94 | 100 / 100 |
| (0) N=8 (16) | 140 / 135 | 141 / 141 |
| (0) N=16 (32) | 141 / 152 | 147 / 147 |
| (0) N=32 (64) | 160 / 155 | 149 (144–149) / 149 |
| (0) N=64 (128) | 149 / 160 | 149 / 149 |
| (A) N=1 / 8 / 64 | 424 / 3,028 / 15,744 | 383 / 2,990 / 13,648 |
| Raw (4) disjoint / same | 5,705 / 5,782 | 5,920 / 5,913 |
| Raw (16) disjoint / same | 21,023 / 9,078 | 20,158 / 8,281 |
| Raw (64) disjoint / same | 88,842 / 8,164 | 88,124 / 6,768 |

The pass 3 (0) latencies at N=32 are p50 432 ms and p99 440 ms. Pass 3 agrees
with pass 2 within about 10% everywhere at 0.5 ms. The (0) values are
quantized: at N=64 and 6 s, one batch is about 11 commits/s of the window.

SQLite in pass 3, at load 4–7:

- `serve` topology: 4,045–4,240 commits/s at 4, 16 and 64 client threads,
  p50 0.22 ms and p99 0.59–0.66 ms.
- Four connections: both cells **failed**. Disjoint failed one run of
  three and same failed two, each with `SQLITE_BUSY` after the 5 s busy
  timeout. The completed runs still committed about 4,800/s in aggregate, and
  one writer committed 0–3 times in a 4 s window.
- Exec/flush: 153.6/230.4 µs, flush 76.7 µs. Estimated serial batch 4,341
  (N=1), 5,786 (N=4), 6,312 (N=16) and 6,459 (N=64) commits/s.

**Single-writer calibration** (one writer, no lock contention,
[calibration-w1.jsonl](./results-20261019-pass3-rtt500/calibration-w1.jsonl),
load 8–12). The table shows the mean ms per mutation of runs 2–3; run 1
carries the fresh-namespace FK effect.

| Setting | Engine | Model R | Engine − model |
| --- | ---: | ---: | ---: |
| unix | 0.571–0.574 | 0.524–0.537 | ≈ 0.04 ms (7%) |
| proxy 0 | 2.97–3.32 | 2.84–3.26 | within run noise (3%) |

### Pass 4: low-RTT recheck

[`results-20261019-pass4-lowrtt/`](./results-20261019-pass4-lowrtt/) holds the
unix, TCP and zero-delay ping, the single-writer calibration over direct TCP
and the zero-delay proxy, and the four-writer engine and model R at unix and
the zero-delay proxy. The load was 4.6–19, with the gate at 6 waiting up to
60 s.

| Setting (4 writers) | Engine disjoint / same | Model R disjoint / same | Model ÷ engine |
| --- | ---: | ---: | ---: |
| unix | 885 (609–886) / 862 (617–883) | 975 (631–994) / 1,080 (646–1,149) | 1.10 / 1.25 |
| proxy 0 | 428 (401–448) / 446 (353–465) | 449 (390–459) / 437 (387–443) | 1.05 / 0.98 |

| Single writer, mean ms per mutation, runs 1–3 | Engine | Model R |
| --- | --- | --- |
| direct TCP | 1.503, 0.987, 0.827 | 1.298, 0.833, 0.867 |
| proxy 0 | 3.505, 2.794, 2.870 | 2.659, 2.471, 2.335 |

Ping p50 in this pass: unix 18.5 µs, TCP 25.2 µs, proxy 0 55.9 µs.

## What this says for the decision rule

LLP 3000.009.001.002 §8: *"W4 with the serial batch (0) on Postgres, at 0.5
ms RTT and its best measured batch size, is below 1,000 commits/s, or below
25% of raw Postgres → commission committer (a)…"*

- (0)'s best at 0.5 ms (ping 0.6 ms) is **160 commits/s** with today's
  per-member statements in pass 2 (N=32 disjoint; 160 at N=64 same). Pass 3,
  at lower load, measured **149/s** (N≥32). With a coalesced tail it reaches
  **192–203/s** (N=64). That is 5–7× below 1,000/s.
- Raw Postgres with the same four writers reaches 5,705/s, and 88,842/s with
  64 writers on disjoint rows. (0) is about **2.8–3.5% of raw Postgres** at
  four writers (2.5% in pass 3: 149 against 5,920), against the 25%
  threshold. Against the most pessimistic raw comparison, 64 writers on one
  row (6,768–8,164/s), it is 2–3%.
- **The rule fires on both conditions**: by 5–7× on the absolute test and
  about 9× on the ratio test. The margin survives the known biases. The model omits the
  engine's in-lock client work, so the engine's (0) would be slower. Each
  proxied statement at the 0.5 ms setting cost about 0.67 ms. At an exact
  0.5 ms, (0) would be about 200/s per-member and 250/s coalesced, still far
  below (see [Network settings](#network-settings-and-the-delay-proxy)).
  Pass 2 and pass 3 agree within about 10% at this RTT.
- The mechanism is the one §3.3 names. (0) keeps every program call's round
  trip inside the serial section (8–10 per member), so throughput is about
  `1/(k_member · RTT)` regardless of N. The flush it amortizes is about
  20 µs here.
- What (a) could reach: its commit stage alone bounds at 15,744/s (N=64,
  three round trips per batch) or 32,304/s (one round trip) at 0.5 ms. That
  is above 1,000/s from N=4 and above 25% of four-writer raw Postgres from
  N=4 (1,687/s). Same-counter traffic under (a) is bounded by its N=1 row,
  424/s at 0.5 ms, before execution. Hot keys stay at (0)'s or the
  reference's rate, as LLP 3000.009.001.000 §6.3's fallback expects.

## Caveats

1. **Engine-level, single host, simulated network.** No HTTP, auth, pooling
   or `serve`. The RTT is a userspace proxy on loopback, not a real network:
   no packet loss, no TCP effects across hosts, about 37 µs of its own
   overhead, and a 2–5% overshoot. Postgres, the proxy and the clients share
   one host that other agents were loading heavily (load 13–130 during
   measurement; never the brief's ~4). The flush on this datacenter NVMe
   (20 µs fdatasync) is far cheaper than a managed database's replicated
   commit, which makes (0)'s flush share even smaller here than in
   production. A slower flush would help (0) relative to the reference but
   cannot remove its k·RTT term.
2. **(0) and (A) are models, not the engine.** (0) replays the captured
   statement sequence under a hand-built committer. It reproduces the
   reference within 10% at ≥0.2 ms RTT. At the Unix socket and the
   zero-delay proxy it is 0–25% faster than the engine (pass 4; 25–35% in
   the noisier pass 2), partly because it omits the engine's client work
   inside the lock. (A) is an upper bound on the commit stage only. It
   omits execution at a snapshot, read-set recording and validation, the
   overlay, conflict reruns and the authority-fact checks that (a) needs,
   and it says nothing about (a)'s correctness or its execution-stage
   bound.
3. **One workload.** These are the increment mutation and a typed one-row
   update. Larger programs (more calls per member) make (0) worse in
   proportion. They also make (a)'s execution stage, which this cell does
   not measure, more expensive. The first run of each fresh namespace is
   slowed by an FK-check plan made on an empty `_commits`. Medians come from
   the two warm runs, and the effect is recorded above rather than tuned
   away.

## Files

- `src/proxy.rs`: the delay proxy. `src/common.rs`: the closed-loop driver,
  WAL/LSN and `pg_stat_wal` deltas, the 2 ms `pg_stat_activity` sampler.
  `src/main.rs`: ping, capture, cell 1. `src/model.rs`: cell 2 (R, 0, A).
  `src/raw.rs`: cell 3. `src/sqlite.rs`: cells 4 and 5.
- `scripts/cluster.sh` (private cluster), `scripts/sweep.sh` (blocks),
  `scripts/tables.py` and `scripts/analysis.py` (tables, H1, calibration).
- `results-20261019-pass1/`: host, `pg_test_fsync`, the statement capture,
  the ping block, and a partial first engine block. That block was stopped
  after four cells when the load gate's wait made the sweep impractically
  slow; it was kept as recorded.
- `results-20261019-pass2/`: the full matrix.
- `results-20261019-pass3-rtt500/`: the single-writer calibration (unix and
  proxy 0) and the 0.5 ms decision cells and SQLite rerun at lower load.
- `results-20261019-pass4-lowrtt/`: the low-RTT recheck of the reference
  calibration.

## S1a: sizing (a)

**Outcome:** Postgres **DO NOT BUILD** at the current call boundary (C=32 ceiling 4,775/s at 0.5 ms, 13.5% of raw). SQLite's best separate-stage model predicts 22,024/s with one reader and batching; the full engine gain is unmeasured.

This extends S0 with **models of two separate stages**, governed by
[the sizing rule, §8](../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md#8-decision-rules).
The prediction is `min(execution at C=32, best full-write-set commit stage
with write p99 <= 100 ms)`. At 0.5 ms the 2× margin requires both **2,000/s**
and **50% of raw Postgres at C=32**, with the disjoint control fixed as the
W4 denominator. The 1% hot-key control is reported separately.

The execution model runs the capture's eight read-only SELECTs, in order,
inside one `REPEATABLE READ READ ONLY` transaction: generation/head,
receipt, generation, receipt, then the two size/fetch pairs. Each execution
makes ten round trips including START and ROLLBACK. It retains the duplicate
reads; it excludes `SELECT ... FOR UPDATE` (the commit-side reservation),
savepoints and writes. C separate connections execute back to back on
disjoint counters. This is a statement model, with no interpreter or overlay.
The shared S0 timer calls completed operations `commits` even for this
read-only cell; `executions_per_s` is also recorded explicitly.

The raw control is S0's durable typed-table autocommit increment, now at
32 writers. `hot1` sends exactly every hundredth operation of each writer
to one shared counter, with writer-specific offsets; all other operations
use that writer's own row. Counter sums check every acknowledged update,
including warm-up and drain.

### Reproduction and measurement custody

From this experiment directory, build only this harness, then start a
private cluster (choose a free high port):

```sh
cargo build --release --locked -j 4
export LD_LIBRARY_PATH="$HOME/tools/pg16/usr/lib/x86_64-linux-gnu"
S1A_SCRATCH=/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/s1a
S1A_ENV=$(scripts/cluster.sh start "$S1A_SCRATCH" 56431)
source "$S1A_ENV"
export SQLITE_DIR="$S1A_SCRATCH/sqlite"
export CP_WARMUP_MS=1000 CP_MEASURE_MS=4000
export NETS="rtt200 rtt500 rtt1000"
```

One command per cell family (each command sweeps the requested settings;
individual invocations below run three repetitions):

| Cell | Complete sweep into a new results directory | One setting |
| --- | --- | --- |
| 3, raw C=32 | `python3 scripts/s1a.py <new-results> raw` | `target/release/snapback4-postgres-commit-path raw --net rtt500 --writers 32 --counters hot1` |
| 1, execution C=8/16/32/64 | `python3 scripts/s1a.py <new-results> execution` | `target/release/snapback4-postgres-commit-path pg-execution --net rtt500 --connections 32` |
| 2, full-write commit stage | `python3 scripts/s1a.py <new-results> commit` | `target/release/snapback4-postgres-commit-path model --protocol A --net rtt500 --counters disjoint --batch 64 --full-writes --non-head-pct 30` |
| 5, SQLite optimistic models | `python3 scripts/s1a.py <new-results> sqlite` | `target/release/snapback4-postgres-commit-path sqlite-execution --threads 32 --dir "$SQLITE_DIR"` and `target/release/snapback4-postgres-commit-path sqlite-commit --batch 64 --dir "$SQLITE_DIR"` |
| Proxy calibration | `python3 scripts/s1a.py <new-results> ping` | `target/release/snapback4-postgres-commit-path ping --net rtt500 --n 3000` |

Default timing is S0's 1 s warm-up and 4 s measurement, three repetitions
per setting, medians with all runs retained. Raw and execution repetitions
use fresh process invocations. The PG commit stage retains S0's three runs
on one namespace: the first run carries its known empty-namespace FK-plan
effect, and the next two are warm. This avoids measuring that startup
effect three times. Every run, including the first, is retained. `NETS` can select a subset of
`rtt200 rtt500 rtt1000`. `scripts/s1a.py` treats each repetition
as a measurement block (all three runs together for the PG commit stage)
and records `uptime` and `vmstat 1 5` before and after it. Initial
starting-load gates of 5–7 leave headroom according to the cell's
thread/connection demand; the final runner records the chosen gate and
samples load each second. Earlier raw repetitions used a fixed starting gate
of 6; the initial ping and two long rejected raw attempts used 8;
a block exceeding 8 is kept as rejected evidence and rerun in fresh files.
A quiet failed product cell is retained as failed, without a success retry.
The runner never changes durability, the existing 5 s timeouts, or retry
limits. Repeating a sweep skips accepted settings and uses new attempt files
for rejected ones. Do not reuse its directory for different parameters.

Raw evidence: [`results-20261020-s1a/`](./results-20261020-s1a/), including
host/version/durability records, JSON with every run and load sample, stdout,
stderr, and before/after host snapshots. Nothing in S0's results is replaced.
The harness lockfile's three local crate versions were refreshed from
0.4.33 to this checkout's 0.4.34; no registry dependency was changed.

Stop only the private cluster started above and remove its socket directory:

```sh
scripts/cluster.sh stop "$S1A_ENV"
```

### Full-write-set commit model

`--full-writes` extends S0 (A), keeping explicit START / one CTE / COMMIT
(three round trips, one durable flush). Every stream member has an `_ops`
receipt and a revision/footprint row, including an authority-fact descriptor.
One `_s1a_meta` clock row advances to the batch maximum, without conflicts;
one revision row advances by the number of stream operations. The full
counter write set remains `r`, `_commits`, `_log`, and `_ops`. No index entry
changes for this increment because its value is not indexed.

A deterministic 0/10/30% of **stream members** are non-head operations,
replacing increments: session-mint-like inserts into the existing `_sessions`
table, including both secondary indexes, plus their receipts and footprints.
They use the same queue, batch, transaction, flush and acknowledgement; they
advance the internal revision but leave the public head unchanged. All-member
throughput is reported as stream operations/s; head throughput is also given
when comparing counter work. The 0% case is the direct W4 denominator match.

As in S0, producers number `max(4, 2N)` and wait for each acknowledgement;
only the committer has a measured database connection. Commit latency includes
queueing and the flush, beginning before enqueue. Batch histograms record
partial batches. N=64's optimistic backlog is larger than P1's 32 synchronous
request workers, so its stage bound assumes queued precomputed work beyond
those workers. The C=32 execution measurement still fixes the combined bound.
No batch fill timer was added.

Post-run checks compare acknowledged increments with counter totals and check
receipt/session/footprint counts, final revision, and the maximum committed
pin, over warm-up, measurement and drain. The short smoke run (excluded from
sizing tables) passed with 4,336 receipts/footprints/revisions, 1,301 sessions,
and 3,035 increments. Initial raw attempts exceeded load 8 and were retained;
the three repetitions were separated by host snapshots and load gating,
with conservative starting-load headroom for the unchanged S0 proxy. The
two rejected 15-second attempts remain in the directory. Later load
rejections are also retained. `python3 scripts/s1a.py <new-results> all`
schedules the same cells serially, taking low-load gaps for cells needing
more headroom, without changing any cell parameters or the load-8 acceptance
ceiling. A load rejection lowers that setting's starting gate by 0.5 for its
next attempt, down to 2. The measured window and all product parameters stay
fixed. This is the final sweep command used here. One controller interruption
cut short an after-snapshot (`commit-04-01`); its completed stdout and partial
snapshot are retained as unqualified evidence, and attempt 02 reran the
cell. Product timeouts and retries were not changed.

### SQLite optimistic models

The execution model translates the same eight reads onto the engine-created
SQLite store's real `_meta`, `_commits`, `_ops`, `r`, `i`, and catalog. It
uses separate `SQLITE_OPEN_READ_ONLY` connections with `query_only=ON`, a
`BEGIN DEFERRED` snapshot, and the existing 5 s busy timeout. Threads are
1/4/16/32. The idle engine connection keeps the WAL open; no writer runs in
this stage. Counter totals must remain zero.

The commit model applies N precomputed disjoint increments in one
`BEGIN IMMEDIATE` transaction with WAL and `synchronous=FULL`, preserving
the default autocheckpoint policy. Every member updates `r` and inserts its
commit, log, receipt and revision/authority footprint. One metadata revision
and one maximum time pin update per batch. SQLite's public head is
`COALESCE(MAX(seq),0)` over `_commits`, as in the actual store; it has no
Postgres-style head row. The timer includes image/receipt construction and
all SQL and COMMIT work. Each member receives the full batch latency.
This is a prefilled-batch stage measurement: it excludes external queueing
and batch fill delay, unlike the PG producer/committer latency.

Receipts, log rows, footprints and counter sums must match every acknowledged
increment, including warm-up/drain. The corrected short smoke runs passed.
The earlier failed SQLite smoke evidence records an implementation mistake
(the model initially assumed a `_meta.seq` row); it is excluded from sizing.
No production store or engine code was changed.

Tables, including three-run spread, worst run p99 and the sizing calculation:

```sh
python3 -I scripts/tables.py results-20261020-s1a
```

### Limits of the S1a prediction

- These are separate **statement-level models**, not an optimistic engine.
  Their minimum is an upper bound, not a measured end-to-end rate or SLO.
  Interpreter execution, read-set recording/validation, authority checks and
  fencing, overlay work, sequence-placeholder rewriting, conflict reruns and
  fallback traffic are omitted. Authority descriptors/footprints are written;
  they do not implement validation. Larger programs or hot keys can lower
  the bound substantially. The hot-key raw control is diagnostic; execution
  and commit models use disjoint increments and predict no hot-key reruns.
- S0's userspace loopback proxy is unchanged. The setting adds delay to each
  direction rather than producing an exact total RTT. Its forwarding threads,
  the clients and PG share the same host; ping calibration and result-specific
  load samples matter. There is no real network, TLS, replicated flush or
  managed-service path here.
- This is one shared, fast-flush host, with short closed-loop windows and
  three repetitions. Load-qualified samples reduce one source of noise but
  do not make the host dedicated. SQLite's batch latency assumes precomputed
  work is available, and its SQL-only read model omits most of Engine's CPU
  work; a model gain over S0's real engine is not a demonstrated engine gain.
  Only the separate stage SLO is tested; combined execution + queue + commit
  latency and open-loop saturation still need an engine measurement.

### Postgres sizing verdict at 0.5 ms

**DO NOT BUILD (a) under §8's sizing rule at the current call boundary.**
C=32 execution is **4,775 executions/s** (4,735–4,849). The best 0% full-write
commit stage within the 100 ms SLO is **12,128/s at N=64** (2,240–12,288,
including the cold first run); all three run p99s are <= 79.3 ms. Thus the
predicted ceiling is **4,775/s**. Raw PG at the fixed 32 writers measures
**35,460/s** disjoint and **35,122/s** with the 1% hot-key mix.

The prediction is **13.5% of the disjoint raw denominator**, below even the
unmargined 25% line (8,865/s). With the required 2× margin, the two bars are
2,000/s and 17,730/s. Execution clears the absolute bar and fails the ratio
bar. The measured explicit-transaction full-write commit stage also fails
the ratio bar with margin,
although it clears the unmargined 25% line. Execution is the smaller stage.
The 10/30% mixed streams reach 12,448/12,528 total stream operations/s at
N=64; neither changes that conclusion. Their head-increment rates are
approximately 90%/70% of those stream rates, rather than extra increments.

The next work named by the rule is reducing mutation round trips (`k`) or
the driver boundary before building the optimistic committer. This is a
sizing verdict, not a correctness rejection of the proposed protocol.

At an ideal exact 0.5 ms per call, ten serial calls would still cap C=32
execution at 6,400/s before client work, below the measured raw margin bar
of 17,730/s. That calculation is a model inference; no rescaled result
replaces the measurements. A more efficient commit protocol alone cannot
remove the measured execution bottleneck.


### S1a result tables

All 62 settings completed, three qualified repetitions each (186 runs). Maximum sampled load in retained blocks, including ping, was 7.68. All counter, receipt, footprint, revision and pin checks passed. 22 load-rejected attempts and 1 interrupted attempt remain as unqualified evidence; corrected smoke failures are separate. No qualified product cell failed.

Full spread and worst-run tails: [tables.md](./results-20261020-s1a/tables.md); machine-readable aggregate and custody audit: [summary.json](./results-20261020-s1a/summary.json). Throughput and p50/p99 are medians of the three run statistics. For SLO selection, conservatively require **all three run p99s <= 100 ms**, including the cold first run. Every PG commit point passed; the largest run p99 was 80.374 ms.

**Proxy calibration** (actual SELECT 1 round trip, ms):

| Nominal added RTT | p50 | p99 |
| ---: | ---: | ---: |
| 0.2 | 0.313 | 0.343 |
| 0.5 | 0.619 | 0.674 |
| 1.0 | 1.123 | 1.146 |

**Cell 1: PG execution MODEL.** Entries are executions/s; p50/p99 ms.

| C | 0.2 ms | 0.5 ms | 1.0 ms |
| ---: | ---: | ---: | ---: |
| 8 | 2,358; 3.390/3.749 | 1,231; 6.501/6.780 | 693; 11.544/11.770 |
| 16 | 4,544; 3.521/3.786 | 2,439; 6.582/6.838 | 1,378; 11.619/11.926 |
| 32 | 10,474; 2.973/3.714 | 4,775; 6.705/6.993 | 2,724; 11.748/12.002 |
| 64 | 22,172; 2.870/3.114 | 10,333; 6.174/6.732 | 5,363; 11.932/12.242 |

**Cell 2: full-write commit MODEL.** Entries are stream operations/s; acknowledgement p50/p99 ms (including enqueue/queue/flush). Non-head percentages replace increments. Producers = max(4, 2N).

| RTT ms | Non-head % | N=1 | N=4 | N=16 | N=64 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.2 | 0 | 621; 6.414/7.269 | 2,533; 3.316/3.646 | 7,004; 4.552/5.114 | 20,943; 6.685/7.698 |
| 0.2 | 10 | 637; 6.296/7.099 | 2,335; 3.449/3.751 | 7,128; 4.401/6.760 | 18,240; 7.005/7.727 |
| 0.2 | 30 | 651; 6.136/6.994 | 2,332; 3.419/3.862 | 7,260; 4.400/4.987 | 18,880; 6.740/7.692 |
| 0.5 | 0 | 410; 9.667/11.108 | 1,481; 5.384/6.332 | 5,012; 6.358/7.122 | 12,128; 10.509/39.262 |
| 0.5 | 10 | 401; 9.903/10.488 | 1,510; 5.378/5.692 | 5,032; 6.288/6.809 | 12,448; 10.295/38.528 |
| 0.5 | 30 | 409; 9.774/10.312 | 1,580; 5.241/5.554 | 5,080; 6.208/7.271 | 12,528; 10.082/12.574 |
| 1.0 | 0 | 248; 16.104/16.947 | 960; 8.322/8.622 | 3,392; 9.394/9.993 | 9,136; 14.024/14.666 |
| 1.0 | 10 | 250; 16.026/16.962 | 959; 8.331/8.638 | 3,436; 9.315/9.767 | 9,376; 13.612/14.488 |
| 1.0 | 30 | 251; 15.967/16.425 | 968; 8.287/9.355 | 3,444; 9.278/9.787 | 9,616; 13.216/14.431 |

**Cell 3: raw PG, 32 concurrent writers.** Entries are commits/s; p50/p99 ms.

| RTT ms | Disjoint | 1% hot-key mix |
| ---: | ---: | ---: |
| 0.2 | 57,689; 0.548/0.698 | 56,055; 0.567/0.720 |
| 0.5 | 35,460; 0.906/1.031 | 35,122; 0.912/1.042 |
| 1.0 | 22,905; 1.397/1.520 | 23,289; 1.374/1.501 |

**Cell 4: predicted PG ceiling, 0% non-head W4 comparison.** N=64 is the best full-write batch within the write SLO at each RTT.

| RTT ms | Execution C=32 /s | Full commit /s | Predicted /s | % of raw disjoint |
| ---: | ---: | ---: | ---: | ---: |
| 0.2 | 10,474 | 20,943 | 10,474 | 18.2% |
| 0.5 | 4,775 | 12,128 | 4,775 | 13.5% |
| 1.0 | 2,724 | 9,136 | 2,724 | 11.9% |

**Cell 5: SQLite MODEL.** Read connections are separate WAL readers; commits are prefilled durable batches. All write-stage run p99s were below 100 ms.

| Reader threads | Executions/s | p50 ms | p99 ms |
| ---: | ---: | ---: | ---: |
| 1 | 22,024 | 0.045 | 0.051 |
| 4 | 5,791 | 0.688 | 0.882 |
| 16 | 2,968 | 5.380 | 6.610 |
| 32 | 2,895 | 11.034 | 13.505 |

| Batch N | Increments/s | p50 ms | p99 ms | Worst run p99 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 11,821 | 0.070 | 0.177 | 0.178 |
| 4 | 29,642 | 0.122 | 0.660 | 0.662 |
| 16 | 64,492 | 0.219 | 1.225 | 1.242 |
| 64 | 103,648 | 0.565 | 2.665 | 2.694 |

**SQLite answer: the model leaves room for improvement with one reader and batched writes.** Its best predicted ceiling is min(22,024, 103,648) = **22,024/s**, **5.24–5.95×** S0's 3,700–4,200/s single-engine `serve` topology. At 32 readers, the model is instead capped at **2,895/s**, below S0. Parallel readers do not scale in this bundled SQLite configuration; the cause was not profiled. The best SQL-only model is not evidence of a 5.2× engine gain: interpreter CPU and the other omitted costs remain to be measured in the engine.


Verification: the experiment-only locked release build, preserved S0 smoke
cells, S1a smoke cells, the complete 62-setting result-integrity audit,
Python syntax checks, and `ref-check --verbose` passed. The private cluster
was stopped and its socket removed; synthetic databases were removed to
recover disk space. Raw results and server/cleanup logs remain here.

## S1b: real network and round-trip reduction

S1b extends these separate-stage **statement models**, without changing the
engine. `scripts/s1b.py` connects from `expo-build-450b` to the existing durable
Postgres 16.15 on `expo-build-450a` (12 cores) through independent SSH local
forwards. It creates and finally drops one `sb4_s1b_<UTC timestamp>_<pid>`
database per invocation; the cluster and other databases are never changed.
Each physical database connection, including admin and sampling connections,
gets a unique tunnel port for the lifetime of a cell process. Tunnel PIDs are
recorded at launch and only those PIDs are stopped. The password is read from
`~/sb4bench/pw` into `PGPASSWORD` and is never included in recorded arguments.

Rerun from this experiment directory, on 450b, with the supplied server and
mode-600 password file already in place:

```sh
cargo build --release --locked -j 4
python3 scripts/s1b.py results-<new-run>-s1b-smoke smoke
python3 scripts/s1b.py results-<new-run>-s1b all
python3 -I scripts/s1b_tables.py results-<new-run>-s1b
```

The runner uses three repetitions, 1 s warm-up and 4 s measurement, just as
S1a. Execution and raw repetitions are fresh subprocesses; full-write commit
cells retain three runs on one namespace, including the known first-run FK
planning effect. Each setting is bracketed by uptime and `vmstat 1 5` on both
hosts, and a `vmstat 1` monitor runs on each host throughout the block. Each
setting also has 1,000-ping before/after RTT controls (200 unmeasured warm-ups),
plus three standalone 3,000-ping RTT runs. No load rejection or product retry
is used: database saturation is itself a measurement. Failed cells remain in
the results. Statement and lock timeouts remain 5 s; durability is unchanged.

The execution baseline is the S1a captured eight-SELECT model, **10**
synchronous round trips including BEGIN and ROLLBACK. The earlier S1a sizing
verdict's “about 12” is not the count implemented by this read-only cell.
The following dependency classification is specific to a successful captured
increment with its counter address supplied as input:

| Read | Address depends on a previous SQL result? | Level / client gate |
|---|---|---|
| generation + head | no | 0; first SELECT takes S |
| replay receipt | no; principal and op id are inputs | 0 |
| generation again | no | 0 |
| receipt again | no | 0; duplicate retained |
| first scan-size preflight | no; slot determines the encoded key range | 0 |
| second scan-size preflight | no; same input slot | 0; duplicate retained |
| first row fetch | no new address; its size preflight gates transfer | 1 |
| second row fetch | no new address; its size preflight gates transfer | 1; duplicate retained |

The first fetched value determines the new counter value, not the second read's
address. This SQL-only model can schedule both preflights together. Generation
and receipt refusal paths, meter refusals, and programs whose later addresses
or control flow depend on earlier row data need a different dependency plan;
this is not an unconditional engine transformation.

| Variant | Wire schedule | `k_exec` |
|---|---|---:|
| baseline | BEGIN, eight SELECTs in capture order, ROLLBACK | 10 |
| k1 | BEGIN; pipeline six level-0 SELECTs; pipeline two fetches; ROLLBACK | 4 |
| k2 | BEGIN; one level-0 UNION ALL / unnest statement; one level-1 unnest join; ROLLBACK | 4 |
| k3p (transport control) | pipeline BEGIN + batched level 0; pipeline batched level 1 + ROLLBACK | 2 |
| k3 | one SimpleQuery message containing BEGIN + EXECUTE of the prepared level-0 batch; one containing EXECUTE of level 1 + ROLLBACK | 2 |

All optimized variants use tokio-postgres. Batches preserve duplicates by tag
and ordinal, including absent receipts; each execution compares all eight read
results to an unmeasured serial reference on that connection, and checks
counters remain unchanged. Setup witnesses check `repeatable read`, read-only,
a stable snapshot across the folded flights, and completed rollback for both
protocol forms. Two flights are the minimum **with the client size gate kept**;
putting that gate or interpreter logic into SQL is outside this experiment.

The first smoke run (`results-20261020-s1b-smoke01`) exposed a large pipelining
stall: k1 about 86 ms and folded extended-protocol k3p about 84 ms at C=2,
versus about 7 ms for the baseline and 3.5 ms for k2. Its original `k3` label
means today's k3p. Those investigative short-window results are preserved,
with their cleanup receipt; they are excluded from sizing. The added k3 uses
one SimpleQuery message per flight to avoid intermediate protocol response
boundaries. The full sweep retains k3p as a control. No TCP/SSH/server settings
were tuned to remove the stall.

The second short smoke (`results-20261020-s1b-smoke02`) checks the final forms
at C=2: baseline 295/s, k1 20/s, k2 547/s, k3p 25/s, and k3 822/s
(k3 p50 2.42 ms, p99 2.81 ms). These are 0.1 s warm-up / 0.4 s windows for
validation and protocol diagnosis, not sizing evidence. Full-window results
and same-host §8 verdicts follow separately.

The first full-sweep startup (`results-20261020-s1b`) hit a local port bind
collision at 56034 before database creation. All 35 recorded tunnels were
stopped. That failed setup is retained. The runner now defaults to local
ports 62000–62143, outside this host's ephemeral range (32768–60999);
`S1B_TUNNEL_BASE` may select another free range. This changes no server,
transport, timeout, durability or workload setting.
