# S1-TB — quarter-rung controls, 2026-10-27

**Supabase W4/A at 3,805/s: FAILS (0/5; first three 0/3). At 4,525/s: FAILS (0/5; first three 0/3).** These verdicts require every repetition to pass; median latency alone does not qualify a rung.

All requested deciding rungs are measured, including rates above a clean failure. Supabase’s historical S1-C W4/A 3,200/s 3/3 result is not reproduced here; no passing rung among 3,200/3,805/4,525 does not imply no capacity at lower untested rates. The table shows medians of clean selected repetition percentiles. Errors are summed across measured windows; maximum per-repetition error fractions, percentile ranges, HTTP-service p99, error classes and ordered repetition flags are in [rate aggregates](./rates.json). Contaminated attempts are retained privately, excluded and rerun once.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p50 / p99 ms | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---:|---:|
| supabase | W4/A | 3,200 | 0/5 | 0/3 | 8.63 / 244.06 | 0.02 / 233.96 | 5,322 | 0 |
| supabase | W4/A | 3,805 | 0/5 | 0/3 | 276.04 / 576.72 | 267.39 / 567.80 | 15,404 | 1 |
| supabase | W4/A | 4,525 | 0/5 | 0/3 | 1004.54 / 1010.30 | 997.72 / 1003.49 | 77,908 | 1 |
| supabase | W5 mix/B | 1,903 | 5/5 | 3/3 | 9.39 / 12.89 | 0.02 / 0.08 | 0 | 0 |
| supabase | W5 mix/B | 2,262 | 5/5 | 3/3 | 9.55 / 29.15 | 0.02 / 15.00 | 0 | 0 |
| supabase | W4/B | 1,903 | 5/5 | 3/3 | 9.37 / 14.30 | 0.02 / 0.05 | 0 | 0 |
| snapback | W4/B | 1,903 | 5/5 | 3/3 | 11.24 / 20.19 | 0.02 / 3.42 | 2 | 0 |
| supabase | W4/B | 2,262 | 5/5 | 3/3 | 9.58 / 12.87 | 0.02 / 0.08 | 0 | 0 |
| snapback | W4/B | 2,262 | 4/5 | 2/3 | 11.94 / 25.12 | 0.02 / 11.03 | 15 | 0 |
| convex | W4/B | 141 | 3/3 | 3/3 | 15.08 / 20.71 | 0.03 / 0.04 | 0 | 0 |

snapback W4/B at 2,262/s has 4/5 clean passes; p99 ranges 24.23–108.33 ms. Its median p99 does not qualify the rung. Ordered flags: PASS, FAIL, PASS, PASS, PASS.


Highest passing **tested** rung in this campaign, requiring 5/5 and separately the **first three** selected repetitions for S1-C comparability. No favorable three-run subset is selected, and untested lower rates are not interpolated. “No tested pass” does not erase historical passing rungs.

| System | Cell | Highest 5/5 /s | Highest first 3/3 /s |
|---|---|---:|---:|
| supabase | W4/A | no tested pass | no tested pass |
| supabase | W5 mix/B | 2,262 | 2,262 |
| supabase | W4/B | 2,262 | 2,262 |
| snapback | W4/B | 1,903 | 1,903 |
| convex | W4/B | not requested (3 reps) | 141 |

**W4/B decision:** Supabase's highest 5/5 rung is 2,262/s; native main's is 1,903/s. Supabase has the higher qualifying tested rate in this paired comparison. Both first-three 3/3 maxima are the same as their five-run maxima.

The new Supabase W5 mix/B control passes 2,262/s 5/5. WC's native 2,262/s 3/3 is therefore tied with this control at the tested three-run rung; it is no longer a strict win against the updated control. Native five-run W5 qualification is not measured here.


The matched W4/B comparison is the native `d6fdc5b72b` product versus unchanged Supabase, measured here. W4/A native concurrent-commit spike results supplied in the brief (3,805/s 6/6, 4,525/s failing on **450a**) are contextual: this lane does not rerun that candidate on 450b. Native W5 mix/B is also outside this commission; [WC](../results-20261027-s1-writes-wc/README.md) reports 2,262/s 3/3, with no 5/5 result. Convex's other cells are not rerun. [Historical S1-C](../results-20261024-s1-onehost-controls/README.md) remains historical, under its earlier boundary-only host check.

**Method.** Same expo-build-450b (`expose-builder-pixel-a`), private socket-only PostgreSQL 16.15, 1M-message fixture, 32 writers/cap 32, 10 s warm-up plus 20 s measurement, A=250 µs/direction and B=500 µs/direction through the common Unix delay proxy. PG logical CPUs 0–2,6–8; service/proxy 3–4,9–10; generator 5,11. S1 pass requires intended-arrival write p99 ≤100 ms, measured errors ≤0.1%, exact durable-counter equality against all acknowledgements including warm-up, in every selected repetition. No bound or durability setting changes. The inherited Supabase SQL drain is unchanged and does not itself prove HTTP quiescence; counter mismatches fail.

Supabase remains the PostgREST-only advocate: PostgREST 14.18, vendor RLS/auth SQL and definer RPCs, pool 32 plus one schema listener, prepared statements, 1,000-entry JWT cache and ordinary durable commit. Before timed load, source hashes, effective PostgREST configuration and live PG settings are compared with S1-C. The effective redacted PostgREST dump matches byte for byte; PG settings match except private port. [Input witness](./s1c-input-witness.json), [all stack, seed, affinity and RTT witnesses](./method-witnesses.json). Outside-Git endpoint adaptation changes only the adapter's hardcoded port 55440 to 55441; every connection uses this lane's private socket. The protected PG17/55440 cluster is neither connected nor changed.

Native Snapback reuses the WC release binary of product `d6fdc5b72b`, verified against recorded SHA-256 **c95bf3d6c6ff78ed596c91e5824af6be4c72008a2cd5274206b81bbfd2ce7f75** before and after measurements. G6 `1000,250`, single owner `ha=none`, arm S/default synchronous commit, shipped depth 2 and no tracing. The reused native generator is WB/WC's release build from frozen S1-C source; current working-tree generator additions are not used. Its artifact hash differs from the original S1-C build, disclosed in the [generator witness](./generator-source-witness.json). [Binary custody](./binary-custody.json), [G6 assumptions](../../../reports/20261024-g6/REPORT.md).

Nonpaired Supabase cells retain fresh service per workload/link/rate cohort, with five repetitions. Paired W4/B uses a fresh service for **each measurement**, alternating Supabase→Snapback five times at 1,903, then five times at 2,262; the same two private fixtures/clusters are reused without concurrent measured traffic. [Execution sequence](./sequence.json). Both idle fixture workers and their PID/start-identified descendants are lane-owned for the contamination census.

The author's brief supplies R1 ruling 9 (quarter rungs 3,805/1,903 and five deciding repetitions). The referenced commit `64e94e52cf` is absent locally; no fetch is authorized or performed. This report applies the explicit brief alongside the local [S1 method](../results-20261024-s1-onehost-controls/METHOD.md) and WC quiet-host rules, without reconstructing unavailable document text.

**Host qualification and audit.** Ten consecutive seconds before each cohort require no unrelated process above 0.3 core and 1-minute load <1.5. A 1 s `/proc` census continues across each full trial, including warm-up and drain. Aggregate unrelated CPU >1.0 core for >2 s cumulative marks CONTAMINATED, retains/excludes that attempt and permits one rerun after another gate. Clean failures are never replaced. CPU tick granularity can amplify the final partial interval; short-lived processes between samples can be missed. These are finite shared-host observations, not a reservation or production-capacity claim.

57 released quiet gates; **50 raw trials / 48 selected**, **2 contaminated attempts**, 0 selected attempts still contaminated. Sampling interval maximum 1.060 s; largest cumulative above-one-core duration 5.980 s. Independent auditing recomputes all 2,577,560 measured arrivals, histograms, latency/error decisions, CPU classifications and counter arithmetic; **0 durable-counter mismatches**. [Qualification](./qualification.json), [verification](./verification.json), [original harness audit after lossless compression](./original-harness-audit.json).

One initial setup attempt fails live affinity **before any timed trial** because the outside-Git endpoint wrapper retained the adapter's original affinity global. All its processes stop; its private PG data is removed only after stopped/socket/pidfile checks. Correcting the wrapper's global initialization restores the prescribed service core split; no product, advocate tuning or checked-in runner change occurs. A separate pre-load wait is stopped to ensure contaminated retries also restart their service; no timed trial is discarded. Both pre-load records, the failed setup evidence and quiet waits caused by unrelated host work are retained in the raw archive.

Minimum observed `/home` free is 27.67 GiB; continuous 25 GiB stop guards never fire. The inactive owned WB, WP and WC/WP build caches are reclaimed during a measurement-free interval, with custody binaries preserved ([receipt](./owned-cache-cleanup.json)). Raw per-trial results, histograms, process identities and CPU samples remain outside Git. Known-secret scans cover raw evidence and summaries before private credential roots are removed. A temporary mode-600 vault outside Git retains the scan values for the final exact staged-blob scan and is then removed. No fetch, push, stash, Git configuration change, product change, paid resource or q24 access. Short windows, finite rungs, shared-host scheduling and different native cache/settlement behavior limit interpretation.

**Optional Convex control.** Existing S1-C-matching backend and CLI were present; no install or build. A fresh private 1M-message fixture passes the full exported fingerprint check. The single requested W4/B 141/s cohort passes 3/3 clean, with zero measured errors and exact counters including warm-up. Pool/query/mutation caps 32, default caches, retention 172,800 s and default 100 ms OCC backoff are unchanged; only the private connection endpoint changes to 55441. No higher Convex rung is tested. [Configuration witness](./convex-configuration.json).

Raw archive: `/home/ccheever/sb4scale/archive/s1-tiebreak-controls-20261027.tar.gz`. SHA-256: **`e3b2de334d8927b3a5cb07d69cc8ec9d19cb3edad8a9f20cb303d9ee3bbe7efd`**.

**PIDs left: none.** Recorded PID/start identities, private paths, cluster sockets/pidfiles and postprocessing children are checked. [Private cleanup](./private-cleanup.json), [process audit](./process-audit.json), [secret audit](./secret-audit.json), [staged audit](./staged-secret-audit.json), [repository checks](./repository-checks.json).
