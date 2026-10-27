# SQW measurement and durability

This lane starts at S1-SQ `99d9499be6` (product baseline `9ee365bbd6`) in
`~/projects/sb4-sqw`, branch `sb4-pg/sqlite-w`, on expo-build-450b (OS hostname
`expose-builder-pixel-a`). It owns `snapback4/target`; debug/test builds use
line tables. No fetch, push, stash or Git configuration change is authorized.
No Postgres process is started or signalled.

The S1 runner, SQLite lifecycle adapter, load harness and Quarry fixture are
unchanged. The final matrix uses six natural-column cells, a fresh service per
cell, 1M verified message images, 128 read/32 write clients, 10-second warm-up,
20-second measured windows and three repetitions at every tested rate. The
ordinary doubling/halving bracket and geometric midpoint are retained, plus
read rungs 19,027, 22,627, 32,000 and 45,254. A rate qualifies only if every
repetition meets intended-arrival p99 (50 ms reads / 100 ms writes), <=0.1%
errors and exact write-counter equality including warm-up. Failed trials are
retained. Single-repetition development probes never qualify a headline rate.

App affinity is 3–4,9–10; the generator uses 5,11. Unused database cores are
not reclaimed. The inherited start gate excludes an unrelated process using
more than one sampled core and requires 30 GiB free. An outer recorder checks
25 GiB throughout builds/runs, records descendant PIDs with birth identities,
and permits signals only to this lane's recorded processes. Builds and timed
capacity windows do not overlap. Private fixtures, bearer files, stdout/stderr,
HDR samples, syscall traces and event streams remain outside Git.

`SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250` is retained. SQLite local hits do
not use a Postgres G6 lease. The cache host module is compiled by the public
CLI's default `postgres` feature; a SQLite service opens no Postgres connection. Cache eligibility additionally requires WAL, a
retained exclusive backend sidecar lock, complete adapter commit observation,
intact callbacks and no external writers. Restart starts with an empty cache.

## Physical durability

Bundled libsqlite3-sys 0.38.2 (rusqlite 0.40.2) is built with
`-DHAVE_FDATASYNC=1 -USQLITE_ENABLE_MEMORY_MANAGEMENT`. The second flag is
inherited from S1-SQ; only HAVE_FDATASYNC is new. SQLite's existing unix VFS
selects the data durability primitive; its FULL transaction ordering, WAL
creation and directory synchronizations remain. Linux fdatasync includes file
metadata needed to retrieve the written data, including file-size changes.
Postgres's comparator uses `wal_sync_method=fdatasync` with durable commit.
Sources: [Linux fsync/fdatasync](https://man7.org/linux/man-pages/man2/fsync.2.html),
[SQLite WAL](https://sqlite.org/wal.html),
[Postgres reliability](https://www.postgresql.org/docs/16/wal-reliability.html).

The existing unbounded WAL high-water retention (`journal_size_limit=-1`) and
1000-frame PASSIVE checkpoint policy are retained, rather than truncating the
initialized WAL after each checkpoint. The custom revision WAL hook reproduces
that checkpoint threshold and ignored-checkpoint-error behavior. Its pragma
reports zero because SQLite uses a custom hook; this is not disabled
checkpointing. New/growing extents still have the expensive synchronization
cost; there is no fallocate-only shortcut or new durability claim for them.

Acknowledgements are released only after successful FULL COMMIT. Bulk history,
change evidence and logs remain in that same physical transaction. Count
mismatches fail and roll back; unknown physical outcomes retain the existing
no-transparent-retry rule. A subprocess witness acknowledges 32-member groups,
is killed with SIGKILL, and verifies both ordinary recovery and recovery after
truncating an append-only WAL to the recorded durable prefix. The lost-suffix
fixture disables checkpointing only to model loss of a later suffix. It is not
a claim of a physical power-cut test or proof of storage firmware behavior.

## Attribution discipline

The capacity matrix has no observer. Separate one-repetition probes instrument
the identical executable with the SQLite observer and cache metrics. The
optional profiler reports only changed-row counts for bulk commit inserts;
it never records SQL text, arguments or bearer values. Batch counts must sum
to the native whole-cohort acknowledgement count. Statement totals include
transaction controls, failed work and background work. WAL and database syncs
are counted separately. CPU/ack is taken from uninstrumented process user+
system tick deltas; edge sample gaps are disclosed.

Development probes progressively combine fdatasync, grouped tails, shared
revision validation, local SQLite hits, a guarded layout proof/final-image
UPDATE, collection fill and vector root/authority reads. These combinations
are not factorial ablations. Changes in N, statements, sync latency and CPU
support mechanism attribution; they do not isolate additive speedups. The authoritative matrix uses no
adaptive target-size override; a separately labelled fixed-32 diagnostic is
allowed by the lane instructions and never qualifies a headline rate. Its known admission-age controller is
unchanged; collection-window behavior is a separate SQLite change. No SQLite
depth-two commit pipeline is implemented: the next wave would need a proven
predecessor overlay and honest handling of a failed/unknown COMMIT. The lane
first measures the simpler, single-writer durable cycle.
