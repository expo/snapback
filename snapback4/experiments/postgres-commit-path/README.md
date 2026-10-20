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
```

One command per cell family (each command sweeps the requested settings;
individual invocations below run three repetitions):

| Cell | Complete sweep into a new results directory | One setting |
| --- | --- | --- |
| 3, raw C=32 | `python3 scripts/s1a.py <new-results> raw` | `target/release/snapback4-postgres-commit-path raw --net rtt500 --writers 32 --counters hot1` |
| 1, execution C=8/16/32/64 | `python3 scripts/s1a.py <new-results> execution` | `target/release/snapback4-postgres-commit-path pg-execution --net rtt500 --connections 32` |
| 2, full-write commit stage | `python3 scripts/s1a.py <new-results> commit` | `target/release/snapback4-postgres-commit-path model --protocol A --net rtt500 --counters disjoint --batch 64 --full-writes --non-head-pct 30` |
| Proxy calibration | `python3 scripts/s1a.py <new-results> ping` | `target/release/snapback4-postgres-commit-path ping --net rtt500 --n 3000` |

Default timing is S0's 1 s warm-up and 4 s measurement, three runs per
setting, medians with all runs retained. `NETS` can select a subset of
`rtt200 rtt500 rtt1000`. `scripts/s1a.py` treats each setting's three runs
as one measurement block and records `uptime` and `vmstat 1 5` before and
after it. It gates at one-minute load <= 4 and samples that load each second;
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
the starting-load gate was tightened from 8 to 4 to leave headroom for the
unchanged S0 proxy. Product timeouts and retries were not changed.
