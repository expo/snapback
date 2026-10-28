# S1-R8 — authoritative SPR8 R0 vs Supabase and native main

Candidate **`6c0fe17c6e`**, main **`982e77a600`**, host **expo-build-450b** (`expose-builder-pixel-a`). All capacities below are highest passing **tested** rungs, with failed repetitions retained. R8 is the restored-protocol experimental R0 with **queued HTTP**, 29 data loans and ≤32 total product connections.

**(a) Write comparison.** Five deciding repetitions per system, interleaved R8 → Supabase per repetition, fresh service for each measurement. All requested rungs run despite earlier failures. First-three counts use the first three selected repetitions, in execution order.

| Cell | R8 highest 5/5 /s | Supabase highest 5/5 /s | Highest first 3/3: R8 / Supabase | Verdict on tested rungs |
|---|---:|---:|---:|---|
| W5 hot1/B | no tested pass | 2,690 | no tested pass / 2,690 | LOSS |
| W5 hot1/A | no tested pass | 3,200 | no tested pass / 3,200 | LOSS |
| W4/B | no tested pass | 2,690 | no tested pass / 2,690 | LOSS |
| W4/A | no tested pass | no tested pass | no tested pass / no tested pass | TIE on tested pass/fail; neither qualifies |

R8 passes **0/55 native write repetitions** across the requested and conditional deciding rungs; the 450a write passes are not reproduced under this host’s frozen S1 method. “No tested pass” is bounded by the requested rungs; it is not zero capacity. W4/A ties only in tested pass/fail outcomes (both 0/5 at 3,805 and 4,525); a maximum-capacity tie is not established. Lower historical results are context only: [S1-R0](../results-20261027-s1-r0-authoritative/README.md) has Supabase W4/A 3,200 and hot1/B 2,690 at 5/5; [S1-TB](../results-20261027-s1-tiebreak-controls/README.md) has W4/B 2,262 at 5/5. No historical run is substituted for a current deciding repetition. The optional hot1/A 2,690 pair is triggered only by a Supabase 3,200 5/5 pass.

Percentiles below are medians of selected clean repetition percentiles, including failures. A median p99 below the SLO cannot qualify a 4/5 rung. A higher passing rung does not erase a lower clean failure or establish monotonic reliability. Sent means are ordered per-repetition conservative HDR upper bounds (the all-arrival HTTP-service histogram sum divided by sent requests; tiny unsent-bookkeeping intervals remain in the numerator). For failed cohorts dominated by unsent expirations, the distribution-free lower bound may be loose, so an upper bound above 6 ms means no certification of that margin, rather than proof that every true sent mean exceeds it; [rate aggregates](./rates.json) preserve percentile ranges, error classes, fractions and ordered pass flags.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p99 ms | Native sent means ms (execution order) | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---|---:|---:|
| r8 | W5 hot1/B | 2,690 | 0/5 | 0/3 | 1112.54 / 1360.00 | 1348.47 | 217.600, 26.177, 221.584, 218.256, 220.753 | 248,155 | 0 |
| supabase | W5 hot1/B | 2,690 | 5/5 | 3/3 | 9.89 / 55.51 | 43.61 | 10.068, 9.936, 9.979, 9.677, 9.847 | 0 | 0 |
| r8 | W5 hot1/B | 3,200 | 0/5 | 0/3 | 1112.54 / 1358.95 | 1348.47 | 218.411, 217.431, 220.717, 220.110, 215.400 | 319,379 | 0 |
| supabase | W5 hot1/B | 3,200 | 0/5 | 0/3 | 1003.49 / 1011.35 | 1001.39 | 10.724, 10.695, 10.473, 10.734, 10.795 | 15,436 | 0 |
| r8 | W5 hot1/B | 3,805 | 0/5 | 0/3 | 1113.59 / 1358.95 | 1350.57 | 220.614, 222.195, 216.669, 218.421, 224.067 | 379,890 | 0 |
| supabase | W5 hot1/B | 3,805 | 0/5 | 0/3 | 1005.58 / 1011.88 | 1003.49 | 10.461, 10.593, 10.775, 10.565, 10.440 | 77,623 | 0 |
| r8 | W5 hot1/A | 3,200 | 0/5 | 0/3 | 1094.71 / 1299.19 | 1289.75 | 185.237, 185.378, 12.987, 183.388, 188.630 | 278,743 | 0 |
| supabase | W5 hot1/A | 3,200 | 5/5 | 3/3 | 7.98 / 17.69 | 7.72 | 8.082, 7.973, 8.078, 8.003, 7.922 | 0 | 0 |
| r8 | W5 hot1/A | 2,690 | 0/5 | 0/3 | 1095.76 / 1303.38 | 1291.85 | 6.638, 186.836, 191.199, 12.491, 191.762 | 181,103 | 0 |
| supabase | W5 hot1/A | 2,690 | 5/5 | 3/3 | 7.67 / 12.76 | 1.19 | 7.715, 7.595, 7.808, 7.769, 7.708 | 0 | 0 |
| r8 | W5 hot1/A | 3,805 | 0/5 | 0/3 | 1094.71 / 1302.33 | 1293.94 | 140.286, 186.532, 187.773, 183.827, 8.416 | 302,787 | 0 |
| supabase | W5 hot1/A | 3,805 | 0/5 | 0/3 | 178.52 / 546.83 | 537.92 | 8.602, 8.410, 8.568, 8.545, 8.570 | 0 | 0 |
| r8 | W4/B | 2,690 | 0/5 | 0/3 | 1111.49 / 1349.52 | 1337.98 | 217.124, 213.771, 220.548, 219.429, 214.789 | 268,413 | 0 |
| supabase | W4/B | 2,690 | 5/5 | 3/3 | 9.86 / 14.98 | 3.12 | 9.959, 9.849, 9.675, 9.902, 9.932 | 0 | 0 |
| r8 | W4/B | 3,200 | 0/5 | 0/3 | 1112.54 / 1351.61 | 1342.18 | 218.524, 218.829, 214.909, 218.586, 221.166 | 319,419 | 0 |
| supabase | W4/B | 3,200 | 0/5 | 0/3 | 1003.49 / 1011.35 | 1001.39 | 10.485, 10.734, 10.894, 10.522, 10.532 | 13,056 | 0 |
| r8 | W4/B | 3,805 | 0/5 | 0/3 | 1111.49 / 1351.61 | 1343.23 | 217.962, 220.782, 217.718, 214.843, 214.743 | 379,837 | 0 |
| supabase | W4/B | 3,805 | 0/5 | 0/3 | 1005.58 / 1011.88 | 1003.49 | 10.583, 10.783, 10.522, 10.737, 10.588 | 79,803 | 0 |
| r8 | W4/A | 3,805 | 0/5 | 0/3 | 1095.76 / 1300.23 | 1291.85 | 189.589, 185.634, 182.962, 188.574, 185.768 | 379,868 | 0 |
| supabase | W4/A | 3,805 | 0/5 | 0/3 | 317.46 / 478.67 | 470.02 | 8.412, 8.623, 8.479, 8.415, 8.624 | 0 | 0 |
| r8 | W4/A | 4,525 | 0/5 | 0/3 | 1095.76 / 1300.23 | 1292.89 | 182.440, 188.368, 187.524, 185.423, 187.783 | 451,852 | 0 |
| supabase | W4/A | 4,525 | 0/5 | 0/3 | 1004.54 / 1010.83 | 1003.49 | 8.607, 8.446, 8.584, 8.460, 8.631 | 78,018 | 0 |

**(b) Exact-key comparison with native main.** The latest landed native-main exact matrix is [S1-WB](../results-20261027-s1-writes-wb/README.md), report `e10c3a22a6`, product `d6fdc5b72b`: highest passing tested exact rung **1,131/s on A and B**. S1-WC/TB do not rerun exact; S1-R0 exact sanity is R0-only. Accordingly this campaign tests 1,131/s, not 450a’s shorter-window 2,096/1,678/s. Main here is newly built `982e77a600`. R8/main alternate for five pairs per link; Supabase has three fresh-service repetitions at each rung.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p99 ms | Native sent means ms (execution order) | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---|---:|---:|
| supabase | W5 exact/A | 1,131 | 0/3 | 0/3 | 1076.89 / 1552.94 | 1524.63 | 117.708, 119.686, 117.824 | 51,697 | 0 |
| supabase | W5 exact/B | 1,131 | 0/3 | 0/3 | 1092.62 / 1661.99 | 1633.68 | 138.547, 133.369, 135.234 | 53,789 | 0 |
| r8 | W5 exact/A | 1,131 | 5/5 | 3/3 | 10.22 / 16.35 | 0.06 | 10.337, 10.574, 10.496, 10.335, 10.351 | 0 | 0 |
| main | W5 exact/A | 1,131 | 5/5 | 3/3 | 10.14 / 14.83 | 0.05 | 10.292, 10.112, 10.230, 10.404, 10.485 | 0 | 0 |
| r8 | W5 exact/B | 1,131 | 5/5 | 3/3 | 12.56 / 23.31 | 0.14 | 12.891, 12.903, 12.765, 12.553, 12.747 | 0 | 0 |
| main | W5 exact/B | 1,131 | 5/5 | 3/3 | 12.48 / 18.30 | 0.05 | 12.552, 12.443, 12.520, 12.473, 12.577 | 0 | 0 |

All six Supabase exact controls also fail the strict durable-counter/observed-ACK equality. Ordered durable-delta minus observed-ACK excesses are **1, 1, 4** on A and **9, 8, 9** on B; all deltas are greater than ACK counts. Request errors occur in these cohorts. This is consistent with ambiguous HTTP outcomes; aggregate counters do not identify individual committed requests or prove a lost acknowledged write. The original mismatches remain failures, with no repair or replacement. [Per-repetition counter receipts](./counter-mismatches.json).

Exact A: **TIE: both 5/5 at the reference rung**.

Exact B: **TIE: both 5/5 at the reference rung**.

No R8 exact repetition misses; the conditional second set is not triggered.

**(c) RFC 003 §8.2 at W4/A 4,525/s.** Native R8 passes **0/5**, first three **0/3**. Ordered native sent means: **182.4396, 188.3678, 187.5239, 185.4235, 187.7827 ms**. Every mean certified ≤6.0 ms by its upper bound: **NO**. Conservative HDR lower bounds are 0.000035, 0.000038, 0.000035, 0.000035, 0.000040 ms. The authorizing R0 gate is NOT met; no authorization for R1–R5 follows.

**(d) Read non-regression.** The [S1-RD reference](../results-20261025-s1-reads/README.md) supplies W1 A/B 8,000/s, W2 A/B 11,313/s and W3 A/B 16,000/s (G6). These are pure-read reference observations, not a mixed-reader progress claim.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p99 ms | Native sent means ms (execution order) | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---|---:|---:|
| r8 | W1/A | 8,000 | 3/3 | 3/3 | 1.48 / 3.67 | 0.09 | 1.634, 1.627, 1.635 | 1 | 0 |
| r8 | W1/B | 8,000 | 3/3 | 3/3 | 2.14 / 7.23 | 0.10 | 2.330, 2.291, 2.337 | 4 | 0 |
| r8 | W2/A | 11,313 | 3/3 | 3/3 | 0.21 / 19.92 | 8.65 | 1.611, 1.365, 1.593 | 0 | 0 |
| r8 | W2/B | 11,313 | 3/3 | 3/3 | 0.21 / 20.58 | 9.31 | 1.792, 1.530, 1.558 | 0 | 0 |
| r8 | W3/A | 16,000 | 3/3 | 3/3 | 0.30 / 33.00 | 25.03 | 0.986, 1.190, 1.060 | 0 | 0 |
| r8 | W3/B | 16,000 | 3/3 | 3/3 | 0.28 / 32.93 | 25.21 | 1.246, 1.044, 0.980 | 0 | 0 |

**All six initial read cells pass 3/3 (18/18); non-regression is established at these tested rungs.**

**(e) Native PG CPU and WAL versus main.** Medians of clean native repetitions; [full costs and ranges](./cost-vs-main.json). Exact R8/main controls are interleaved per repetition. The three W4/hot1 main cost controls are separately scheduled at the same offered rates; they are descriptive cost comparisons, not five-repetition capacity qualification. Failed cohorts can have lower ACK throughput, and rejected/expired work remains in their CPU and WAL numerators. These per-ACK costs do not estimate intrinsic successful-write efficiency for a cohort that fails its SLO.

| Cell / offered /s | Reps R8/main | PG CPU ms/ACK R8/main | R8/main PG ratio | App CPU ms/ACK R8/main | WAL B/ACK R8/main | R8/main WAL ratio | Syncs/ACK R8/main |
|---|:---:|---:|---:|---:|---:|---:|---:|
| W4/A / 3,805 | 5/3 | 60.3058 / 0.1998 | 301.91× | 15.6630 / 0.3788 | 20952.5 / 630.9 | 33.21× | 33.58654 / 0.09116 |
| W4/A / 4,525 | 5/3 | 57.3421 / 0.2030 | 282.44× | 14.6372 / 0.3293 | 23869.7 / 624.4 | 38.23× | 34.16425 / 0.09122 |
| W5 hot1/B / 3,200 | 5/3 | 54.2448 / 0.2112 | 256.87× | 14.8330 / 0.4080 | 23177.2 / 614.6 | 37.71× | 30.23350 / 0.09185 |
| W5 exact/A / 1,131 | 5/5 | 0.4711 / 0.4734 | 1.00× | 0.5199 / 0.4898 | 1166.7 / 548.0 | 2.13× | 0.21582 / 0.22140 |
| W5 exact/B / 1,131 | 5/5 | 0.3949 / 0.3918 | 1.01× | 0.4993 / 0.4698 | 779.3 / 536.1 | 1.45× | 0.17719 / 0.18155 |

PG CPU includes the private cluster’s background/observer work. The outside-Git 100 ms PID/birth sampler interpolates the controller’s generator launch +100 ms scheduler lead +10 s warmup over 20 s, divided by measured successful ACKs (including completions in drain). App CPU is the server; proxy is retained separately. WAL/sync snapshots cover warmup, measurement, drain and ordinary background maintenance, divided by all ACKs including warmup; PG reporting lag remains possible. These clocks/divisors are not additive residence components. The RFC’s CPU target/default-on budget is not waived by a capacity win.

**Prefix, loan and failure diagnostics.** Every native R8 W4/A and hot1/B measurement has an indexed, separate fresh-service companion using the existing PROFILE/STATS/SERIES collectors: [diagnostic table](./DIAGNOSTICS.md), [numeric coverage](./write-diagnostics.json). Native SLO collectors remain off. Available data width is 29, product cap 32; readers/control share the real pool. Prefix lag, confirmed-above-W holds, outcome-confirm→prefix reply-release wait (the aggregate includes void/error outcomes and cannot isolate committed-only ACKs), time-weighted loan occupancy, custody and pool waits belong to the companion, never the identical native window. Missing series coverage is N/A. Native CPU/WAL and sent means belong to the original trial.

Across all five clean companions per cell, median direct-submission→owner/lane-entry time is **165.3 ms** for W4/A and **195.3–197.2 ms** for hot1/B, versus pool wait **0.0014–0.0016 ms**, loan custody **3.44–4.10 ms**, and outcome-confirm→prefix release **11.13–12.74 ms**. All 25 measured series cover the full window; sampled product connections peak at **32** and data loans at **28**. This locates a large observed residence component at owner/lane entry in the diagnostic companions; the combined timer does not identify which mutex or holder initiated it, and it does not establish the native failure’s root cause.

Retained ownership/fail-stop events: **0**. [Failure receipts](./ownership-failure.json) retain their phase/cell/repetition, errors, counter audit and exit/settlement evidence. An owner exit is a failed repetition. No clean product failure is replaced.

[Every native >100 ms repetition](./tail-attribution.json) retains its intended p99, dispatch p99, HTTP p99/max, worst one-second intended-arrival slices, error classes and contamination census. Dispatch backlog versus HTTP residence is attributed from those observed histograms. Cumulative WAL snapshots and /proc series do not identify a per-fsync native timeline, so isolated WAL clustering is not claimed as a proven initiating cause. Diagnostic companions cannot retroactively supply that timing for another native cohort.

**Build and method custody.** [R8 build](./r8-build.json), [main build](./main-build.json), [selected SPR8 environment](./round8-run-source.json), [references](./context.json). The reused clean worktree `/home/ccheever/projects/sb4-r0b` switches from `ad1bfc1839` to `sb4-pg/r8-450b`; both release/Postgres builds share its original `snapback4/target/s1-r0b`, with `--release --locked --offline -j 6 -p snapback4 --features postgres`, `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_RELEASE_DEBUG=line-tables-only`, `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. R8 and main are separately preserved/hash-checked; no same-binary flag-off equivalence is assumed. Owned superseded build artifacts are pruned only after both binaries are saved and verified; no measured service overlaps cache reclamation. The cache receipts retain the exact scope and timing.

R8 enables `SNAPBACK4_SPIKE_R=1`, session fence, async head, direct dispatch, explicit wire, local I/O, **queued HTTP**, parallel preparation, cached closure, outside capacity, coalesced publication, width 29 and main O collection, exactly the non-diagnostic selections in `round8-run.json`. Native profiles, PG clocks, stats, series and route-series are absent. Main leaves R off. Both retain G6 `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`, synchronous arm S and default depth 2. Prefix-ordered ACKs, footprint holds through W, immutable bases, two images, enriched attempt/key races, deadlines/freshness and actual catch-up/retention remain paid.

Unchanged `s1-onehost.py`, frozen S1-C generator and existing Engine::seed_at fixture helper from S1-R0/WC/TB. Private PG16.15, deterministic million-message image and maintained-total equality; PG CPUs 0–2,6–8, app/proxy 3–4,9–10, generator 5,11. A adds 250 µs/direction; B 500 µs/direction. Every measurement starts a fresh service with 10 s warmup +20 s measurement, 32 writers or 128 readers, cap 32. [Method witnesses](./method-witnesses.json), [generator source witness](./generator-source-witness.json), [binary custody](./binary-custody.json).

The unchanged [S1 pass rule](../results-20261024-s1-onehost-controls/METHOD.md) requires intended-arrival p99 ≤100 ms writes /50 ms reads, measured error fraction ≤0.1%, and exact durable counter delta against all ACKs including warmup. Expired arrivals and dispatch lag stay included. Supabase retains PostgREST 14.18 advocate SQL, RLS/auth, prepared statements, pool 32 plus listener, JWT cache 1,000 and its native SQL drain. Effective redacted configuration matches S1-C byte for byte; live PG settings match except private port. Fsync, synchronous_commit and full_page_writes stay on, shared_buffers 8 GiB, WAL min/max 1/4 GiB, JIT off. The unchanged TB endpoint transplant targets private socket **55441**. [S1-C inputs](./s1c-input-witness.json), [endpoint receipt](./endpoint-adaptation.json).

**Host qualification and retained setup.** Ten consecutive quiet seconds before every cohort require no unrelated process above 0.3 core and 1-minute load <1.5. A 1 s PID/birth census spans warmup/load/drain. Aggregate unrelated CPU >1 core for >2 s cumulative marks CONTAMINATED, retains/excludes the attempt, and permits one fresh-service retry after a new quiet gate. A retry still contaminated is ineligible. Idle peer fixtures and supervisor descendants are lane owned. Finite sampling can miss short-lived work; this is a shared-host observation, not exclusive reservation.

An outside-Git fail-stop-observer module binding failed before PG startup or timing and was corrected; its stopped empty setup is retained. After 81 completed native measurements, PostgREST startup for the next Supabase control failed with Address in use before any generator started. Both fixtures stopped cleanly; the normal R8 worker close removed its PG data, while Supabase retained its fixture. The continuation validates Supabase against its final completed counter snapshot and recreates R8 through the unchanged frozen seed helper. It resumes at the missing control; every completed trial and the failed startup entry remain in sequence metadata. An untimed socket-bind readiness wait precedes later fresh-service starts; endpoints, configurations, workload and SLOs stay fixed. The continuation adapter also had an existing-custody-file write error before PG start, which was corrected and retained. [Interruption receipt](./startup-interruption.json). A disappearance-safe wait-channel reader and post-exit counter snapshot preserve fail-stop failures without changing scheduler, load, SLOs or product code. Raw setup records and source copies are archived.

**188 raw attempts / 188 selected; 0 contaminated attempts; 0 selected still contaminated.** 382 released quiet gates, minimum 10.141 s; maximum census interval 1.233 s. Independent auditing recomputes 14,802,980 measured arrivals, every SLO/error/counter decision and histogram identity: **6 counter mismatches**. [Qualification](./qualification.json), [verification](./verification.json), [execution sequence](./sequence.json), [original auditor](./original-harness-audit.json).

Minimum observed `/home` free **25.77 GiB**, above the continuous 25 GiB stop floor. Final free at report render: **33.25 GiB**.

Short windows, finite rungs, host scheduling and native cache/settlement differences limit interpretation. No product/checked-in runner change, origin fetch, push, stash, Git configuration change, paid resource or publication. No action targets q24 or the protected PG17/55440 cluster. This is not default-on, crash/takeover, mixed-read-floor, SDK or publication qualification.

Raw trial/HDR/process/CPU/series evidence stays outside Git: `/home/ccheever/sb4scale/archive/s1-r8-authoritative-20261027.tar.gz`. SHA-256 **`e446edcd243b673261e91a8cafb704f238e55a64a22f0ece401b3bc19092ca99`**.

**PIDs left: none.** Recorded PID/start and private-path audits cover build, PG, services, proxies, generators, controllers and postprocessors. Private sockets/pidfiles and credential cleanup are checked. Known-secret scans cover raw evidence, report summaries and exact staged blobs. [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [secret audit](./secret-audit.json), [staged audit](./staged-secret-audit.json), [repository checks](./repository-checks.json).

[Additional owned-cache reclamation](./cache-reclamation.json) records profile locking, saved-binary verification, absence of running measured services, timing and reclaimed space.

[Superseded executable reclamation](./superseded-binary-reclamation.json) verifies archived recovery copies before deleting earlier completed-lane executables; the active R8/main binaries and frozen generator/seed helper are preserved. [Timing audit](./superseded-binary-reclamation-audit.json) confirms no measurement overlap.
