# RCPU: release read CPU on private Postgres

Lane `sb4-pg/rcpu`, required PIPE base `c7a0a597ee` on `480f88e8b4`.
This is a local, unpublished read optimization. Final qualification and final
before/after tables are recorded in subsequent entries below.

## Method

expo-build-450a (OS hostname expose-builder-nothing, verified through its local
Tailscale address), Ryzen 5 3600, 6 physical cores / 12 threads, Rust 1.97.0.
Only release builds measure throughput; release debug is line-tables-only.
The owned target is `snapback4/target`; every Cargo command uses eight jobs.
The stock S1 Quarry application and native seed produce 1,000,000 messages,
8,448 memberships, 1,025 rooms, 256 users and 257 counters. Maintained fields
are assigned by the engine, never SQL. Native seeding took 1,796.996 seconds,
under concurrent host compilation; the standard VACUUM (ANALYZE) follows it.

Client to serve uses loopback TCP, pooled keep-alive reqwest, closed-loop
64/128/256 clients, one-second warm-up and common five-second measured windows.
Postgres is private PG16.15, port 55461, reached through its Unix socket because
public serve retains its Unix-only database profile. No delay is injected.
These short capacity diagnostics are not open-loop S1 rung/SLO qualification or
a result on the natural 0.6ms / added-0.5ms campaign links.

The harness records process CPU at the common measured boundaries, including
PG's live and reaped children. CPU/read divides by successful completions in
the window, including warm-up completions and excluding drain. Latencies below
are for validated successful arrivals; admission errors remain visible. Loads
are the one-minute values sampled at both common boundaries. At load >2,
a two-second process-CPU census distinguishes decaying owned load from active
other work; competing work waits up to 30 minutes. The census and every wait
are retained. No build/test runs during a measured window. Before retained windows with load >2, the final census reports other-work CPU
below 0.5 core.

Uninstrumented release binaries supply throughput and process CPU. Separate
release clock builds provide stage attribution, using CLOCK_THREAD_CPUTIME_ID,
with nested spans and the PG connection future's polls timed on their actual
threads. gprofng 2.42's collector produces no usable clock samples here, even
after a timer-zero initialization workaround. Temporary clock/allocator code
and its lint exception are removed before qualification and commits. The clock
instrumentation self-check verifies nesting and two independent threads.
Its allocator CPU estimate exceeds total CPU in one baseline; that estimate
is discarded. Allocations remain included in measured stage and process CPU.

A native witness holds 30 idle HTTP keep-alive sockets and completes a new
authorized W1 request: idle sockets do not pin the short worker pool. The
baseline still has 30 active short workers and 98 queued permits.

Raw logs, profiles, tokens, cluster data and process ledgers remain outside Git
under `/tmp/sb4-rcpu`. The shared PG17 cluster on 55440 is not changed.

## Initial baseline and prepared-cache-only intermediate

All values are measured, without best-of selection. CPU is microseconds per
successful completion; latency is milliseconds.

| Arm | Shape | Clients | Reads/s | p50 / p99 | Server CPU | PG CPU | Client CPU | Errors | Load before / after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PIPE release | W1 | 128 | 5,113 | 24.69 / 36.34 | 454.9 | 1660.7 | 88.0 | 76 | 10.73 / 12.43 |
| PIPE release | W1 | 256 | 4,489 | 41.22 / 95.62 | 606.4 | 1651.6 | 229.9 | 16504 | 16.61 / 19.52 |
| PIPE release | W1 | 64 | 5,188 | 12.10 / 19.73 | 447.2 | 1657.7 | 84.8 | 0 | 1.43 / 4.36 |
| PIPE release | W2 | 128 | 4,756 | 26.53 / 40.17 | 615.6 | 1627.8 | 128.7 | 153 | 11.44 / 13.96 |
| PIPE release | W2 | 256 | 4,123 | 43.84 / 89.19 | 781.5 | 1634.7 | 275.0 | 16018 | 17.96 / 24.05 |
| PIPE release | W2 | 64 | 4,748 | 13.16 / 22.35 | 609.5 | 1620.9 | 122.6 | 0 | 4.01 / 6.25 |
| PIPE release | W3 | 128 | 2,532 | 49.64 / 72.35 | 1362.0 | 2908.0 | 133.5 | 225 | 15.01 / 16.61 |
| PIPE release | W3 | 256 | 2,309 | 73.79 / 126.68 | 1630.3 | 2909.7 | 389.8 | 15976 | 22.12 / 25.56 |
| PIPE release | W3 | 64 | 2,661 | 23.54 / 37.19 | 1344.4 | 2909.7 | 120.2 | 0 | 8.88 / 10.73 |
| Prepared / auto plans | W1 | 128 | 6,320 | 19.96 / 30.82 | 440.8 | 1245.0 | 86.1 | 119 | 3.63 / 6.54 |
| Prepared / auto plans | W2 | 128 | 5,513 | 22.81 / 35.59 | 602.6 | 1277.4 | 125.9 | 142 | 7.94 / 9.95 |
| Prepared / auto plans | W3 | 128 | 2,923 | 43.32 / 56.98 | 1345.8 | 2514.4 | 128.6 | 253 | 9.95 / 11.63 |

The code-only cache is bounded to 32 prepared statements per physical reader,
with SQL and parameter types in its identity. LRU eviction reclaims only code.
Each data Bind/Execute/Sync has its own implicit transaction and fresh snapshot;
no result, viewer, allow bit or authority survives a request. Cold preparation
is a separate counted flight. Ordinary ingress retains query_typed, including
the unknown-token one-flight bound. Writers and fallback custody are unchanged.

The cache-only arm improves throughput but leaves large PG CPU costs. Automatic
Postgres plan selection still pays most of the baseline cost; this intermediate
is retained rather than presented as the final CPU solution.

## Checks so far

Default core: 1,138 passed / 0 failed / 5 named ignores, 47 top-level targets.
Reader transport/cache: 6 passed / 0 failed. Both RT0 ratchets plus publication
cut witnesses: 5 passed / 0 failed; warm PG W1/W2/W3 is unchanged at 1/1/1,
SQLite 5/5/132. The unchanged ratchet files are not edited. Cold PG data reads
now include preparation (2 flights in this witness). Four harness correctness
checks pass, with exact arrival/histogram counts and valid responses; combining
closed-loop and rate is rejected. Full final binary/PG/ref qualification and
owned process cleanup remain to be completed before this lane is done.
