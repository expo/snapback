# Method deltas from S1-PG2

The governing method is [S1-PG2](../results-20261022-snapback-postgres-2/METHOD.md).
The following deltas are explicitly commissioned for S1-PG4.

Both product binaries are release builds from separate target directories in
this worktree: `45416b150c` in `target-pre`, and `e76a77549e` in `target-b1`.
Both use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, the `postgres`
feature and locked dependencies. The same existing Rust generator binary and
Quarry schema match S1-PG2 by SHA-256. No timed HTTP request adds an operation
id or `store_id`; these remain the unkeyed account-session classes.

PostgreSQL 16.15 runs privately on expo-build-450b, port 55448, instead of the
shared PG17.9 cluster on 450a. All measured database streams use local Unix
sockets through the existing Rust proxy; there is no SSH transport. Proxy
`--delay-us 500` means 250 microseconds per direction (link A), and
`--delay-us 1000` means 500 microseconds per direction (link B). These are
requested added RTTs; recorded prepared SELECT 1 measurements establish the
actual path. Each boundary has 100 warm-up queries then 1,000 measured queries.
Any p99 above 3 ms stops the campaign; a clear retry cannot replace a breach.

The six physical cores have SMT pairs 0/6 through 5/11. PostgreSQL owns cores
0–2/6–8; app and proxy own 3–4/9–10; the generator owns 5/11. These physical
sets are disjoint. The app and generator have fewer cores than in PG2; this
is a comparison between the two pinned products under this split, not a
comparison of absolute ceilings with historical hosts. Proxy CPU remains part
of the app-side budget and is sampled separately outside the product.

The recorded durable settings match PG2: fsync, synchronous_commit and
full_page_writes on, fdatasync, 8 GiB shared buffers, 320 connections,
4 GiB maximum/1 GiB minimum WAL, JIT off, and statement/IO/WAL observers on.
The local socket is private to this user and uses trust authentication;
TCP authentication is rejected. Application identity still uses the original
256 native account bearer sessions. No password is needed or logged.

Before each cell the controller records /proc/loadavg and the busiest processes
over a one-second CPU sample. Unrelated work above one core causes a recorded
wait and another sample. Owned process CPU and host load continue to be sampled
through setup and load. These observations establish the checked boundaries,
not a reservation of the machine.

Each product revision gets one native 1M seed through the unchanged helper,
compiled against that revision's core. It uses Engine::seed_at in 4,000-message
transactions, standard lease renewal and no supplied maintained fields.
Source-image and maintained-total recounts bind the two fixtures to the same
deterministic image. A prior reuse check proved that B1 reads the baseline
account session and leaves every application row and backend record unchanged,
but B1 added dormant-evolution metadata tables. An overly strict physical-schema
equality assertion stopped that setup and cleaned its cluster before B1 timed
load. The six completed baseline cells remain retained. B1 therefore uses a
fresh cluster with byte-identical settings and its own native seed. The optional
cells reuse that second fixture only after a native baseline open/query and
physical-schema/row-digest check.

Every workload/link cell gets a fresh serve process. The unchanged search starts
at 1,000/s for reads, 3,200/s for disjoint/1% writes, or 100/s for exact shared
writes; it halves/doubles to bracket and tests one geometric midpoint. Every
rate has three repetitions of 10 s warm-up and 20 s measurement. Read clients
are 128; write concurrency is 32. All repetitions must have intended-arrival
p99 at most 50 ms for reads /100 ms for writes, errors at most 0.1%, and exact
whole-cohort write-counter correspondence. Reported latency is the median and
range across the three repetitions at the highest passing offered rate.

Clean SQL probes retain ten warm-ups and sixty serial native operations, or
100 operations for the exact nominal 1% mixture. pg_stat_statements is filtered
by this database and the application role; observers use a separate owner role.
Standard five-statement lease renewals are explicitly subtracted. Two SET LOCAL
statements share one synchronous driver call per durable COMMIT, so inferred
warm exchanges subtract one per non-renewal durable commit. These counts are
source-based inference from SQL execution counts, not wire captures or cold
prepare measurements. pg_stat_database and WAL observations retain their
database-wide/cluster-wide scope and reporting-lag limitations.

PG2's two native account-session FIFO barriers and stable-counter observations
are unchanged and remain outside timing. They do not prove HTTP quiescence:
unknown outcomes fail the whole-cohort audit, and adjacent-trial counter gaps
are retained separately. No failed trial or contaminated cell is promoted.

A separate owner-role observer holds one idle connection beginning during
baseline link B. After all app processes exit and PostgreSQL receives its
smart-shutdown request, it reads the final counter sum and disconnects. It
executes no query during load and writes no managed data. This independently
binds the final store total to the complete probe/trial counter ledger.

Large raw evidence stays outside Git with its archive location and SHA-256.
The private cluster and credential files are removed after owned-process
cleanup. The result-directory date follows the requested name; timestamps in
provenance give the actual observation interval.
