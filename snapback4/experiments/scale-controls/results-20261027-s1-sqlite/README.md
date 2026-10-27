# S1-SQ — current Snapback 4 on SQLite

**4/6 strict wins against the requested S1-C natural-column control snapshot.** Product **`9ee365bbd6`**, release-built in this worktree on expo-build-450b (OS hostname `expose-builder-pixel-a`). **Natural column only: SQLite has no database link.** WAL and `synchronous=FULL` remain unchanged. The inherited `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` matches both the old SQLite run and prior native one-host builds. These are one-host S1 short-window observations, not production-capacity claims.

Every selected offered rate passes all three repetitions: 10 s warm-up + 20 s measurement, intended-arrival p99 ≤50 ms reads /100 ms writes, errors ≤0.1%, and exact write-counter equality including warm-up. Latencies below are medians of the three repetition percentiles; WIN means strictly higher offered rate than max(Supabase, Convex). No failed repetition is replaced.

| Cell | SQLite offered/s · p50/p99 ms | Best requested control · offered/s · p50/p99 ms | Verdict | SQLite 2026-10-22 · change |
|---|---:|---:|:---:|---:|
| W1 | **16,000 · 0.79/24.63** | Supabase · 2,000 · 3.10/3.73 | **WIN** | 2,828 · 5.66× |
| W2 | **8,000 · 0.65/3.22** | Supabase · 2,000 · 3.51/4.29 | **WIN** | 5,656 · 1.41× |
| W3 | **2,828 · 2.47/9.31** | Convex · 8,000 · 0.43/2.93 | **LOSS** | 2,828 · 1.00× |
| W4 | **1,131 · 21.25/43.75** | Supabase · 3,200 · 8.02/29.44 | **LOSS** | 100 · 11.31× |
| W5 exact | **1,131 · 26.53/56.66** | Convex · 25 · 22.56/28.80 | **WIN** | 100 · 11.31× |
| W5 nominal 1% mix | **1,131 · 21.23/42.63** | Supabase · 800 · 7.20/13.89 | **WIN** | 100 · 11.31× |

The primary comparison uses exactly [`results-20261024-s1-onehost-controls`](../results-20261024-s1-onehost-controls/README.md), A/natural. A still pays its local database proxy delay of 250 µs per direction; SQLite has no database hop and receives no extra CPU cores. **W2 caveat:** that snapshot's Convex 707/s was search-dependent. The [later identical-method re-search](../results-20261024-s1-onehost-final/README.md) reaches **8,000/s**; current SQLite **ties** that stronger control. Thus the table's W2 WIN does not establish a strict win over the later Convex result. W3 and W4 lose in the requested table.

The old SQLite figures are from [2026-10-22](../results-20261022-snapback-sqlite/README.md). Its app/generator budgets were three physical cores each; the current method uses two/one, matching the one-host controls. These are revision-plus-method comparisons, not an isolated group-commit or cache speedup. Baseline archive hashes and **51 selected baseline repetitions** were independently checked against the reported medians. [Verification](./baseline-verification.json).

## Cache and write costs

SQLite is explicitly excluded from revision-cache eligibility because it has no complete durable revision stream. G5/G6 hits are zero, with **0% effective cached-query share** in every read cell; a lookup hit rate has no denominator. `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250` is set as requested and has no cache effect on SQLite. W3 still computes its 32-room inbox through ordinary snapshots and the interpreter. SQLite and OS page caches remain active. This is not a SQLite G6 measurement.

| Read cell | G5 query-hit share | G6 query-hit share | SQLite statements/ack † | App CPU µs/ack |
|---|---:|---:|---:|---:|
| W1 | 0% | 0% | 5.01 | 221.54 |
| W2 | 0% | 0% | 5.02 | 386.96 |
| W3 | 0% | 0% | 132.08 | 1,261.32 |

| Write cell · offered/s | Mean N † | Fsyncs/write † | Statements/member, all / writer † | App CPU µs/ack | Diagnostic p99 ms † |
|---|---:|---:|---:|---:|---:|
| W4 · 1,131 | 15.23 | 0.0674 | 15.65 / 15.65 | 472.15 | 800.06 |
| W5 exact · 1,131 | 16.06 | 0.0637 | 18.62 / 18.62 | 517.29 | 972.55 |
| W5 nominal 1% mix · 1,131 | 15.20 | 0.0676 | 15.69 / 15.68 | 475.42 | 112.33 |

† Batch/statement/flush counts come from **separate observation of the same immutable executable at the selected offered rate**, with one 10 s + 20 s repetition, native counter equality and unchanged durability. Instrumentation can change fill/latency; these are not hidden capacity-run counters. Both selected and first-failing rates are observed. Mean N is inferred from acknowledgements and WAL-synced writer COMMITs. Fsyncs/write includes checkpoint flushes; statements/ack include transaction controls, authentication, failed-request work and ordinary background work. App CPU is the uninstrumented selected-rate median, process-wide user+system ticks per whole-cohort acknowledgement; sample boundary intervals are omitted. [Resources](./resources.md), [all diagnostic aggregates](./diagnostic.json), [latency ledger and repetition ranges](./ledger.md), [tested-rate curves](./curves.json).

## Fsync diagnosis

**The ≈3× difference is reproduced on the same device/filesystem.** Both SQLite and the PG controls use `/dev/nvme0n1p3`, ext4. On fully initialized 16 MiB files, bare `fdatasync` averages **2.55–2.77 ms**, while `fsync` medians are near **7.6–8.0 ms**. Growing files or converting `posix_fallocate`'s unwritten extents costs about **8 ms even with `fdatasync`**. PG16.15's `pg_test_fsync` independently reproduces **2.714 vs 8.206 ms/op** on the same `/tmp` volume. The controls configure `fdatasync`; unchanged bundled SQLite actually calls `fsync`. Method and allocation/metadata state explain the reproduced gap; a different device is ruled out. Journal/barrier versus controller contributions are not separately isolated. **No new build-option, pragma, preallocation, mount or barrier tuning is applied to the product.** [Full diagnosis and primary source](./FSYNC.md), [bare-sync receipts](./fsync-probe.json), [actual-syscall observations](./diagnostic.json).

## Losing cells

**W3 — app CPU on the uncached inbox path.** At the first failed 4,000/s rung, the app consumes 3.98/4 assigned logical CPUs (two physical cores), versus 0.68/2 for the generator. Physical read-byte deltas are zero. Intended-arrival / dispatch / HTTP-service p99 medians are 1,064.83 / 1,032.85 / 74.58 ms. The separate selected-rate probe executes 132.1 server SQLite statements per acknowledged query, including any failed-request work in the diagnostic capture. G5/G6 do not reuse the 32-room result; ordinary SQLite snapshots and interpreter work remain. This identifies the app CPU budget as binding; no instruction-level profile is claimed.

**W4 — serialized SQLite write-cycle/flush limit.** The first failed rung is 1,600/s, with app CPU 0.60/4 logical CPUs and generator CPU 0.28/2. The selected-rate diagnostic has mean N=15.23, 0.0674 flushes/write, mean WAL sync 7.87 ms and 15.6 writer statements/member. Flushes alone consume 525.9 µs/ack; the sole writer also executes member SQL and commit/checkpoint work. Overall app cores remain available, while the ordered writer must wait for physical durability. The source/CPU/flush observations support this cycle bottleneck; they do not isolate every residual cycle stage.

[Detailed bottleneck evidence](./BOTTLENECKS.md). W2's later-control tie also binds before the 11,313/s rung; its uncached page path is retained in the first-failure and statement ledgers.

## Qualification, custody and limitations

The unchanged independent auditor passes **123 capacity trials / 27,453,480 measured intended arrivals**, plus the smoke and diagnostic captures. Direct before/after arithmetic checks **42 capacity write trials**, with **0 counter mismatches**. Failed latency/error trials remain in the curves and raw archive. [Audits](./audit.json), [counter audit](./counter-arithmetic-audit.json), [disqualifications](./disqualified-summary.json).

The 1M-message fixture verifies every message image, maintained room/sender total, membership/last-read offset and counter. Live affinity witnesses retain app 3–4,9–10 and generator 5,11; unused PG cores are not reclaimed. Read ladders include 19,027,22,627,32,000,45,254. Every released start satisfies the inherited no-unrelated-process-above-one-sampled-core rule. There are **13 released observations / 0 busy waits** across the retained segments; this boundary rule does not reserve the host during load. Database RTT is inapplicable to SQLite. Minimum recorded `/home` free space is **41.03 GiB**, above both the 25 GiB outer stop and the runner's 30 GiB boundary floor. [Seed equality](./seed-equality.json), [affinity](./affinity.json), [host/load](./host-load.json), [disk](./disk.json).

The original smoke's three trials pass, but its controller exits 1 after an exclusive-create replay-metadata error. Two matrix setup attempts end before timed trials, including a restoration/deploy error. Those attempts, errors and successful cleanup remain archived; the complete matrix uses one authoritative cohort per cell. The setup/metadata fixes affect no product or timed workload. A later CLI-only guard rejects a nonexistent SQLite link B. [Method, setup history and replay](./METHOD.md), [product/build provenance](./provenance.json), [build hashes](./build.json), [checks](./checks.json).

The initial build records Cargo but has an incomplete compiler-descendant census; Cargo exited zero and the final process inspection finds no lane build/helper. The host is shared; short serial windows, search granularity, changed dates/revision and non-monotonic tails limit causal conclusions. No complete product battery or publication qualification is claimed. No origin fetch, push, stash, Git configuration change, publication, paid service or product/Quarry edit. Known-secret scans precede removal of private runtime stores; raw trials, HDR, event logs, samples and identities stay outside Git. **PIDs left: none.** [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [secret scans](./secret-audit.json).

Archive: `/home/ccheever/sb4scale/archive/s1-sqlite-20261027.tar.gz`. **SHA-256: `237a2bd5d6d3619951ea1ff9822cd826bad8fc1b19d5ab32bf6118a23fb9c96e`**. [Archive receipt](./archive.json).
