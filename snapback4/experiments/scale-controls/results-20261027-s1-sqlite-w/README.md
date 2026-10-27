# SQW — SQLite writes and owned read reuse

**6/6 strict wins** against the best Supabase/Convex controls, including the later Convex W2 re-search. Corrected product **`1b38085f58`**, release SHA-256 `afeb62f07d9105b7a6782de32ecd092f46f6442f323be85ba891cd0c434b020d`, on expo-build-450b (OS hostname `expose-builder-pixel-a`). These are one-host S1 short-window observations.

Every selected offered rate passes all three repetitions: 10 seconds warm-up + 20 seconds measured, intended-arrival p99 ≤50 ms reads /100 ms writes, errors ≤0.1%, and exact counter equality including warm-up. The unchanged native runner uses a fresh service per cell and the same ladder, concurrency and CPU budgets. Percentiles below are medians of repetition percentiles; WIN means a strictly higher qualified offered rate. Failed repetitions remain in the record.

| Cell | SQW offered/s · p50/p99 ms | Best control · offered/s | Verdict | S1-SQ offered/s | Change |
|---|---:|---:|:---:|---:|---:|
| W1 | **16,000 · 1.26/38.70** | Supabase · 2,000 | **WIN** | 16,000 | 1.00× |
| W2 | **11,313 · 0.20/12.57** | Convex · 8,000 | **WIN** | 8,000 | 1.41× |
| W3 | **16,000 · 0.27/40.89** | Convex · 8,000 | **WIN** | 2,828 | 5.66× |
| W4 | **4,525 · 9.63/25.85** | Supabase · 3,200 | **WIN** | 1,131 | 4.00× |
| W5 exact | **3,200 · 8.74/25.25** | Convex · 25 | **WIN** | 1,131 | 2.83× |
| W5 nominal 1% mix | **4,525 · 10.10/27.72** | Supabase · 800 | **WIN** | 1,131 | 4.00× |

Controls come from [S1-C A/natural](../results-20261024-s1-onehost-controls/README.md), with W2 strengthened to the [later Convex 8,000/s re-search](../results-20261024-s1-onehost-final/README.md). The [S1-SQ baseline](../results-20261027-s1-sqlite/README.md) therefore ties that W2 control; its original 4/6-win table used the older W2 snapshot. SQLite has no database hop. App affinity stays 3–4,9–10; the generator stays 5,11; unused database cores are not reassigned to the app.

W1 capacity matches S1-SQ; its p99 changes from 24.63 to 38.70 ms. Qualification follows every repetition’s SLO, not the median alone. [Repetition ranges and CPU](comparison.json), [all tested-rate aggregates](curves.json).

Uninstrumented selected-rate CPU uses process user+system ticks divided by whole-cohort acknowledgements, matching S1-SQ. Sparse edge samples can omit a small boundary interval. Cache/statement figures come from separate one-repetition observation of the identical executable; instrumentation can change fill and latency and does not qualify capacity.

| Read cell | App CPU µs/ack · S1-SQ | SQLite statements/ack † | Local query-hit share † | G5 / G6 share † |
|---|---:|---:|---:|---:|
| W1 | 235.42 · 221.54 | 5.01 | 0.00% | 0.00% / 0.00% |
| W2 | 172.49 · 386.96 | 2.37 | 88.32% | 0.00% / 0.00% |
| W3 | 138.94 · 1261.32 | 3.56 | 98.81% | 0.00% / 0.00% |

The local tier is a SQLite equivalent, not a Postgres G6 grant. It requires the retained exclusive backend lock, WAL, complete adapter commit observation, intact callbacks, no external writers and an empty cache on restart. A hit checks the same revision before and after resolving ordinary cached facts with a fresh request clock and supervisor revision. A race takes ordinary validation. Shared device/unowned handles remain excluded. An uncached inbox still executes **132** SQLite statements; this lane does not claim a set-based uncached inbox rewrite.

| Write cell · offered/s | Mean N † | Statements/member, all / writer † | Writer wall µs/member † | App CPU µs/ack | WAL sync/commit p50/p99 ms † |
|---|---:|---:|---:|---:|---:|
| W4 · 4,525 | 28.64 | 0.59 / 0.59 | 156.11 | 221.01 | 2.60/5.23 |
| W5 exact · 3,200 | 19.66 | 1.86 / 1.86 | 225.77 | 253.44 | 2.51/4.97 |
| W5 nominal 1% mix · 4,525 | 28.39 | 0.61 / 0.61 | 155.69 | 221.61 | 2.56/5.06 |

† Whole-cohort diagnostic counts include transaction controls, failed-request work and background work. Mean N is the directly observed committed-member count divided by physical groups; the count must equal native acknowledgements. Writer wall spans BEGIN through COMMIT completion; it includes SQL, interpretation, sync, checkpointing and scheduling, not CPU alone. Cache shares use metric-frame deltas at native before/after boundaries. [Per-call and per-commit sync distributions, batch histograms, non-sync writer time, cache/controller details, selected and first-failing probes](costs.json).

| W4 lever | Evidence and attribution |
|---|---|
| fdatasync | Bundled SQLite now calls fdatasync under FULL. S1-SQ’s mean WAL fsync was 7.87 ms; the selected final diagnostic’s mean WAL call is 2.61 ms. The actual syscall trace also retains the directory synchronization. |
| Written WAL reuse | Keep the existing 1000-frame PASSIVE checkpoint and `journal_size_limit=-1` high-water policy. Reuse written blocks; new/growing extents still cost about 8 ms. No isolated additional speedup is assigned to retention. |
| Statements and writer work | Count-checked family tails, qualified final-image UPDATE and vector root/authority reads reduce S1-SQ’s 15.65 statements/member to 0.59. Every member retains its serial authority, meter, receipt, intermediate image and history. Final writer wall is 156.11 µs/member, including sync. |
| Cohort interruptions | A wholly empty bulk cycle now coalesces commit notifications for up to 100 ms after repaying existing CPU debt. Skipped turns do not prove emptiness; useful pacing and aged service remain. The first passing 4,525/s development probe follows this change. |
| Flush overlap | No new depth-two SQLite flush pipeline is implemented and no speedup is attributed to it. Such a pipeline needs predecessor-state transfer and an honest checkpoint/WAL-generation failure protocol; this lane keeps native FULL COMMIT on the writer thread. |

The development variants are progressive combinations, not factorial ablations. A two-millisecond collection window does not improve the target and is reverted. Direct target metrics and a separate fixed-32 experiment show no adaptive collapse in those probes; fixed-32 also misses 4,525/s. Its local source override is removed. The size controller and queue policy remain unchanged. The final matrix uses ordinary adaptive sizing and no observation/override flags. The optional recent-cohort collection remains bounded to one millisecond.

FULL WAL durability remains matched: the native WAL and creation/directory syncs complete before successful COMMIT releases any write continuation or reply. Bulk tails and images remain one atomic transaction; count mismatches roll back, and unknown physical outcomes never authorize transparent retry. The SIGKILL and durable-prefix truncation witness recovers every acknowledged group. This models loss of a later WAL suffix; no physical power-cut experiment is claimed. [Method, sources and durability argument](METHOD.md), [syscall receipt](syscalls.json), [governing context](ORIENTATION.md).

The unchanged independent auditor verifies **126 matrix trials / 30,390,720 measured intended arrivals**. Independent arithmetic checks **42 write trials / 0 counter mismatches**. Seed image equality, CPU affinity, source/binary hashes, disk bounds and owned-process cleanup are recorded in [custody](custody.json). [Disqualified trial aggregates](disqualified-summary.json) retain every failed rate/repetition.

Final affected checks: **core 873/0**, **CLI 627/0** (pass/fail); 498 / 75 ignored, including private-PG suites and subprocess helpers. The parent crash test explicitly runs its ignored child. SQLite RT0, command/program groups, revision-cache and serving witnesses pass. Ref-check has **0 errors / 0 unchecked references**. [Check receipts](checks.json).

An earlier matrix is interrupted before qualification when review finds the ASCII-family and buffered-authority-cut gaps; its completed W1 samples are retained separately. A development setup also refuses a briefly occupied port before serving any trial. Initial CLI checks lack the sibling executable and later require the expected RT0 table to fall; these are repaired before final qualification. Raw attempts and their native cleanup records remain archived. No failed repetition is replaced.

Raw evidence stays outside Git at `/home/ccheever/sb4scale/archive/s1-sqlite-w-20261027.tar.gz`; SHA-256 **`aa488761965115a71a8ba5f3f3eb4b90a599a78296f7dbf421b08047f8f21f88`**. Private stores and bearer files are excluded. Final owned child/helper PIDs: **0**; `/home` free **36.57 GiB**. No fetch, push, stash, Git configuration change or publication is performed. The branch preserves both implementation commits and the report commit.
