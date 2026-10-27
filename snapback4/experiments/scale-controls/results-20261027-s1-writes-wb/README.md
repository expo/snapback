# S1-WB — six synchronous write cells after the batch-controller fix

**Snapback wins 3/6 against the best historical Supabase/Convex control, improves 1/6 against S1-WP and 2/6 against S1-WF.** Product `d6fdc5b72b8e84f640e670e187c5b663768f49af` from supplied local `sb4-pg/main-bc`, measured on `sb4-pg/s1-wb`. WF + Stage P are present; adaptive max N stays 32, latency is diagnostic only, and both PG writers and their constant protocol helpers prepare before READY. No product or checked-in runner changes.

Configuration: **G6 `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`, synchronous commit arm S, shipped pipeline depth 2**. This is the declared single-owner `ha=none`, clock-qualified deployment ([G6 assumptions](../../../reports/20261024-g6/REPORT.md)). It does not qualify HA or arbitrary clock steps.

Host `expo-build-450b`, OS hostname `expose-builder-pixel-a`, Ryzen 5 3600, six physical/twelve logical CPUs. Waited for `/tmp/sqw.done`: observed 2026-10-27 06:34:14 UTC, before branch switch/build/load. Native trial cohorts span 2026-10-27 07:21:41 UTC–2026-10-27 08:51:29 UTC. [Preflight](./preflight.json), [build custody](./build.json), [binary integrity](./binary-integrity.json).

Values are **highest passing tested offered writes/s · median p50/p99 ms across three repetitions**. Every repetition must meet intended-arrival p99 ≤100 ms, errors ≤0.1%, and durable-counter equality against **all acknowledgements including warm-up**. WIN means strictly greater; ties are not wins. Controls were not rerun: [controls](../results-20261024-s1-onehost-controls/README.md), [S1-WP](../results-20261026-s1-writes-wp/README.md), [S1-WF](../results-20261026-s1-writes-wf/README.md).

| Cell | Link | Best Supabase/Convex | S1-WP | S1-WF | WB: offered /s · p50/p99 ms | vs control | vs WP | vs WF | WP delta |
|---|---|---:|---:|---:|---:|:---:|:---:|:---:|---:|
| W4 | A | 3,200 · 8.02/29.44 (Supabase) | 2,262 · 9.93/39.32 | 2,262 · 10.19/14.82 | 1,131 · 17.01/34.90 | LOSS | LOSS | LOSS | -50.0% |
| W4 | B | 1,600 · 9.36/17.91 (Supabase) | 1,600 · 10.80/17.73 | 2,262 · 12.68/53.05 | 1,131 · 18.01/35.88 | LOSS | LOSS | LOSS | -29.3% |
| W5 exact | A | 25 · 22.56/28.80 (Convex) | 2,262 · 15.59/68.55 | 1,600 · 11.12/14.97 | 1,131 · 16.61/34.24 | WIN | LOSS | LOSS | -50.0% |
| W5 exact | B | 70 · 8.07/8.82 (Supabase) | 70 · 23.13/30.88 | 800 · 11.85/15.52 | 1,131 · 19.64/38.17 | WIN | WIN | WIN | +1515.7% |
| W5 nominal 1% mix | A | 800 · 7.20/13.89 (Supabase) | 2,262 · 10.32/46.96 | 800 · 8.92/26.90 | 1,131 · 16.92/38.47 | WIN | LOSS | WIN | -50.0% |
| W5 nominal 1% mix | B | 1,600 · 9.30/14.33 (Supabase) | 1,600 · 11.06/19.99 | 1,600 · 11.49/47.28 | 1,131 · 18.07/45.25 | LOSS | LOSS | LOSS | -29.3% |

Link-B W4 100/s smoke qualifies **3/3**, versus WP's 0/3. All three link-B write shapes also qualify **3/3 at 100/s** in the native matrix. **The persistent low-rate collapse did not reproduce** in the W4/B smoke or W5 exact/B 100/s trigger cohorts. Separate diagnostic traces retain target 32 throughout. Intermittent errors at other low rates and overload/SLO failures remain disqualifying. [Smoke](./smoke-complete.json), [all rate curves](./curves.json), [batch diagnostics](./batch-diagnostics.json).

The unchanged `s1-onehost.py --system snapback` uses its existing explicit-rates interface, driven by an outside-Git selector that reproduces inherited double/halve + one geometric midpoint, then fills **100, 200, 400, 800, 1,131, 1,600, 2,262, 3,200, 4,525/s in every cell**, with three repetitions at each. Passing 4,525 extends upward by √2. Already-tested cohorts are reused; failed repetitions are never replaced. This fills the commissioned exact-key low-rate search gap. It remains a finite grid, not a continuous capacity proof. **4 cells pass a higher tested rate after a lower-rate failure**; these lower failures are retained in [non-monotonic outcomes](./nonmonotonic.json). Historical control search gaps remain visible.

The validated 1M-message fixture, fixed seeds, 32 open-loop writers/cap 32, 10 s warm-up + 20 s measurement, fresh service per cell, and exact archived S1-C native generator source are unchanged. PG16.15 has fsync, synchronous_commit and full_page_writes on. PG CPUs 0–2,6–8; app/proxy 3–4,9–10; generator 5,11. Link A adds 250 µs/direction; B 500 µs/direction. Runner PG port and core flags retain defaults. [Fixture](./seed-equality.json), [generator source](./generator-source-verification.json), [affinity](./affinity.json), [deployment witnesses](./deployment-witness.json), [provenance](./provenance.json).

| Cell | Link | Rate /s | Mean N† | Target trajectory† | PG CPU µs/write‡ | App CPU µs/write‡ |
|---|---|---:|---:|---|---:|---:|
| W4 | A | 1131 | 3.91 | 32 throughout | 279.1 | 501.3 |
| W4 | B | 1131 | 4.54 | 32 throughout | 272.3 | 522.6 |
| W5 exact | A | 1131 | 4.56 | 32 throughout | 309.8 | 502.6 |
| W5 exact | B | 1131 | 5.57 | 32 throughout | 280.9 | 526.7 |
| W5 nominal 1% mix | A | 1131 | 3.87 | 32 throughout | 298.3 | 522.3 |
| W5 nominal 1% mix | B | 1131 | 4.60 | 32 throughout | 289.1 | 526.4 |

† Mean N is the median of repetition means from **separate official `SNAPBACK4_BATCH_TRACE` cohorts using the same immutable release binary**, at each selected native rate. The sample covers completion batches during whole trials, including warm-up and drain; it is not a measured-request-only mean. Target trajectories stay 32; zero target transitions, N≤32. The probe also retains low-rate W4/B and exact/B 100/s cohorts. Probe qualification is recorded independently and never selects native capacity. This diagnostic does not expose in-flight occupancy, flights/batch or Q/X/C/release; none is inferred. [Probe metrics and ranges](./batch-diagnostics.json).

‡ Native PG/app CPU comes from the same outside-Git 100 ms sampler used by WP. Whole-cohort CPU is divided by whole-cohort acknowledged writes, including warm-up and drain/snapshot overhead. PG includes private-cluster background and observer CPU; app is server + delay proxy. PID/start identities protect tick differences; short-lived processes between samples can be missed. Observer overhead is unquantified. These are costs per acknowledgement, not isolated measured-window CPU ceilings. [CPU ranges and server/proxy split](./native-cpu.json).

Independent unchanged auditing covers **168 native trials / 5,132,940 measured intended arrivals**, including smoke. Independent before/after arithmetic checks every native and diagnostic counter; **zero mismatches**. **77 native trials disqualify**, overlapping reasons are errors in 77 trials and latency in 73. Diagnostic audit covers 24 trials; 0 disqualify. Every failure and all individual evidence remain in the private archive. [Native audit](./audit.json), [counter audit](./counter-audit.json), [native disqualifications](./disqualified-summary.json), [diagnostic audit](./diagnostic-audit.json), [diagnostic counter audit](./diagnostic-counter-audit.json), [diagnostic disqualifications](./diagnostic-disqualified-summary.json).

All 13 released starts (native and diagnostic) satisfy the inherited one-second rule of no unrelated process above one core; 4 busy observations cause waits. All 26 before/after HTTP-cell RTT captures complete; the inherited rule requires complete captures, without an added absolute RTT cutoff. Boundary load averages and RTT percentile records are retained in [RTT/load](./rtt-load.json). Minimum observed `/home` free is 31.16 GiB. A 0.5 s outer guard and build/runner guards enforce 25 GiB. [Disk](./disk.json).

A one-second diagnostic observation during W4/A records 6 unrelated active processes using 3.93 logical cores together. This is a single runtime observation, not a cell-wide host census or an exclusion rule. Some failed native cohorts have dominant `expired_before_send` errors and low HTTP-service p99 relative to intended-arrival p99; [curves](./curves.json) retain dispatch lag, HTTP-service p99 and error classes. Host/generator contention can affect these offered-rate results; this run does not attribute the revision deltas causally. [Shared-host observation](./shared-host-observation.json).

These short serial windows compare a shared host with historical control/revision measurements. A clean cell-start check does not reserve host resources throughout the trials. Ladder deltas are observed changes, not causal speedup estimates. Failed native trials are retained; successful traced requests cannot rescue a native failure. This benchmark configuration does not establish production capacity or publication qualification.

No fetch, push, stash, Git configuration change, paid resources or publication. Raw trials, histograms, CPU samples and batch traces stay outside Git. Known-secret scans cover raw artifacts, report summaries and exact staged blobs. **PIDs left: none**, including build tools, services, proxy, generators, samplers, monitors, controllers and private PG. [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [secret audit](./secret-audit.json), [staged audit](./staged-secret-audit.json).

Independent comparison verification re-read 219 source repetitions. [Verification](./verification.json), [repository checks](./repository-checks.json).

Archive receipt: [archive.json](./archive.json). The archive embeds the hash-verified WP archive, which includes WF and earlier Snapback/control evidence transitively.

Archive: `/home/ccheever/sb4scale/archive/s1-writes-wb-20261027.tar.gz`. **SHA-256: `0f482a25733f50723bcd7c1b237ca0aaefc6646bf4a14cd55188d466f6a3b8f6`**.
