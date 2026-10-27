# S1-WC — contention check on the S1-WB write result

**Verdict: WB's 1,131/s cap was a shared-host contention artifact; the paired test does not reproduce a product regression at W4/A 2,262/s.** The exact WB release binary now passes W4/A and W5 mix/B at **2,262/s, 3/3 each**, and W4/B at **1,600/s, 3/3**. Main and the rebuilt WP product both pass **3/3** in the interleaved W4/A control. This is scoped benchmark evidence, not proof that every performance characteristic is unchanged.

| Cell | WB highest pass /s | WC highest pass /s | WC p50 / p99 ms |
|---|---:|---:|---:|
| W4/A | 1,131 | 2,262 | 9.90 / 25.46 |
| W5 mix/B | 1,131 | 2,262 | 13.75 / 74.38 |
| W4/B | 1,131 | 1,600 | 10.78 / 17.96 |

Each rate below has three full repetitions. Latency and dispatch columns are medians of repetition percentiles, including clean failures. Pass requires intended-arrival p99 ≤100 ms, measured errors ≤0.1%, and durable-counter equality against **all** acknowledgements including warm-up in every repetition. A 2/3 rate fails qualification. † Errors sum across the three measured windows; error classes and latency ranges are in [rate summaries](./rates.json).

| Cell | Offered /s | Passes | p50 / p99 ms | Dispatch lag p50 / p99 ms | Errors† | Contaminated |
|---|---:|:---:|---:|---:|---:|:---:|
| W4/A | 1,131 | 3/3 | 8.55 / 15.65 | 0.02 / 0.12 | 0 | 0 |
| W4/A | 1,600 | 3/3 | 8.96 / 30.87 | 0.02 / 11.00 | 1 | 0 |
| W4/A | 2,262 | 3/3 | 9.90 / 25.46 | 0.02 / 11.09 | 2 | 0 |
| W4/A | 3,200 | 0/3 | 1006.11 / 1014.50 | 996.15 / 1004.54 | 29,499 | 0 |
| W5 mix/B | 1,131 | 3/3 | 10.14 / 15.96 | 0.02 / 0.05 | 0 | 0 |
| W5 mix/B | 1,600 | 3/3 | 10.95 / 18.42 | 0.02 / 0.27 | 0 | 0 |
| W5 mix/B | 2,262 | 3/3 | 13.75 / 74.38 | 0.02 / 60.23 | 38 | 0 |
| W5 mix/B | 3,200 | 0/3 | 1007.16 / 1015.55 | 997.20 / 1005.58 | 54,327 | 0 |
| W4/B | 1,600 | 3/3 | 10.78 / 17.96 | 0.02 / 0.14 | 1 | 0 |
| W4/B | 2,262 | 2/3 | 12.62 / 37.00 | 0.02 / 22.86 | 8 | 0 |

W4/B 2,262/s has one clean p99 failure at **110.10 ms**; its other repetitions pass. Its median p99 therefore does not qualify the rate. W4/A and W5 mix/B 3,200/s fail cleanly, dominated by `expired_before_send` and approximately one-second dispatch lag. These failures remain in the record. Each cell stops climbing after its first clean-failing rate. No clean failure is replaced, and no contaminated rerun is needed.

**Paired revision control.** Fresh service for every measurement, W4/A 2,262/s, main → WP repeated three times, with the quiet rule before every cohort. The same private fixture, generator, affinity, settings, links and qualification apply to both binaries.

| Product | Commit | Passes at 2,262/s | p50 / p99 ms | Dispatch p99 ms | Contaminated |
|---|---|:---:|---:|---:|:---:|
| main | `d6fdc5b72b` | 3/3 | 9.95 / 21.40 | 7.25 | 0 |
| wp | `9ee365bbd6` | 3/3 | 9.90 / 22.15 | 8.02 | 0 |

| Order | Product | Result | p50 / p99 ms | Dispatch p99 ms | Errors | Contaminated |
|---:|---|:---:|---:|---:|---:|:---:|
| 1 | main | PASS | 9.90 / 20.64 | 6.50 | 2 | no |
| 2 | wp | PASS | 9.98 / 75.50 | 61.34 | 0 | no |
| 3 | main | PASS | 10.04 / 21.40 | 7.25 | 0 | no |
| 4 | wp | PASS | 9.90 / 22.15 | 8.02 | 0 | no |
| 5 | main | PASS | 9.95 / 43.94 | 29.79 | 0 | no |
| 6 | wp | PASS | 9.90 / 19.43 | 5.37 | 0 | no |

The matching pass counts and roughly 10 ms p50s contradict a regression large enough to explain WB's universal 1,131/s cap. The unchanged main binary recovers twice WB's passing rate in two tested cells; W4/B recovers its historical WP 1,600/s rung. WB's W4/A 2,262/s had 0/3 passes, median dispatch p99 **1,014.50 ms**, and HTTP-service p99 **32.06 ms**; WC's main matrix at that rate has 3/3 passes and median dispatch p99 **11.09 ms**. Dispatch lag can also arise from clean overload, as the retained 3,200/s failures show; it alone does not establish external contention. The unchanged-binary recovery, quiet-host sampling and paired control supply the attribution. [WB](../results-20261027-s1-writes-wb/README.md), [WP](../results-20261026-s1-writes-wp/README.md), [paired aggregates](./paired.json), [sequence](./paired-sequence.json).

**Method and host qualification.** Host expo-build-450b (`expose-builder-pixel-a`). Unchanged checked-in `s1-onehost.py --system snapback` and exact WB/S1-C native generator bytes; G6 `1000,250`, arm S/default synchronous commit, default depth 2, 32 writers/cap 32, validated 1M-message fixture, 10 s warm-up + 20 s measurement. PG16.15 retains `fsync`, `synchronous_commit` and `full_page_writes` on. PG CPUs 0–2,6–8; app/proxy 3–4,9–10; generator 5,11. A adds 250 µs/direction, B 500 µs/direction. Fresh service per matrix workload/link cell, matching WB; paired services restart for every measurement. Native product tracing stays off. WB's supplemental 100 ms PG/app CPU sampler is retained, alongside the new 1 s unrelated-process census.

G6 sets `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250` under the declared single-owner `ha=none` clock-bound deployment assumptions. [G6 assumptions](../../../reports/20261024-g6/REPORT.md).

Outside-Git orchestration supplies the requested ascending rungs, cohort gates, CPU samples and contamination handling through the runner's existing interfaces. The private PG16 socket uses **55441** to avoid the protected PG17/55440 cluster; the benchmark resource/durability settings are unchanged. Main reuses the WB binary only after its recorded SHA-256 matches. WP is a release/Postgres build of local `9ee365bbd6`, in its own `snapback4/target/s1-wc-wp`, with the same SQLite build flag and pinned compiler. No fetch or product/checked-in runner changes. [Build custody](./main-binary.json), [WP build](./wp-build.json), [source verification](./wp-source-verification.json), [fixture, affinity and all RTT captures](./method-witnesses.json).

Before each cell and each rate cohort, **10 consecutive seconds** require no unrelated process above 0.3 core and 1-minute load <1.5. The census samples `/proc` CPU ticks at 1 s continuously throughout each full trial, including warm-up and drain. PID/start identities and lane-owned descendants distinguish benchmark processes. Raw comm names, users and CPU samples stay outside Git. Contamination is conservatively defined as **aggregate** unrelated CPU >1.0 core for >2 s cumulative; this also excludes sustained >2 s events. A contaminated attempt would be retained, excluded and rerun once after a new quiet gate. Final partial intervals are retained; CPU tick granularity can amplify their instantaneous core estimates.

All **26 quiet gates** pass; **36 trials**, **0 contaminated**, **0 reruns**. Maximum CPU sampling interval is **1.119 s**. The largest above-one-core duration in any trial is **0.016 s**, below the 2 s rule. No trial is called contaminated merely because benchmark-owned work raises load after the start. Independent auditing verifies all **1,486,320 measured arrivals**, histogram counts, SLO/error decisions, quiet tails, CPU classifications and durable sums; **0 counter mismatches**. [Qualification](./qualification.json), [quiet-host receipts](./quiet-host.json), [verification](./verification.json).

**WB process attribution.** The hash-verified WB archive's one-second snapshot names six unrelated processes, all **`snapback4`**: PIDs **450120, 450213, 449783, 441015, 449126, 441807**, together **3.93 logical cores**, each allowed all 12 logical CPUs. The snapshot records no UID/user or command line. All original PID/start identities had exited by WC preflight, so their users and originating jobs cannot be established from this evidence. No ownership is guessed. This observation is evidence of contention during WB, not a continuous census of every WB trial. [Attribution and archive anchor](./wb-process-attribution.json).

Short serial windows on a shared host, one paired workload/rate and a coarse ladder limit the conclusion. The other three WB write cells are not rerun. This report does not establish production capacity, publication qualification or the absence of smaller regressions elsewhere.

Minimum observed `/home` free is **28.99 GiB**, with a continuous 25 GiB stop guard. Raw trials, histograms and process samples remain outside Git. Known-secret scans cover raw evidence, summaries and exact staged blobs. **PIDs left: none** after recorded-identity, private-path, cluster/socket/pidfile and postprocessor checks. No push, stash, Git configuration change, paid resources, publication, q24 access or protected-cluster action. [Disk](./disk.json), [private cleanup](./private-cleanup.json), [process audit](./process-audit.json), [secret audit](./secret-audit.json), [staged audit](./staged-secret-audit.json), [repository checks](./repository-checks.json), [archive receipt](./archive.json).

Raw archive: `/home/ccheever/sb4scale/archive/s1-writes-wc-20261027.tar.gz`. SHA-256: **`7f8071e0bf782bf13dfa27d4991a67529b218b65e55b2a8b71539be8c30fb658`**.
