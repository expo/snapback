# S1-WP — six synchronous write cells with WF + Stage P

**Snapback wins 2/6 cells against the best Supabase/Convex control, improves 2/6 against S1-WF and 5/6 against 2026-10-24.** Product **`9ee365bbd683c053158152ae352f420798dcbaa4`**, supplied local `sb4-pg/main-wp`, contains WF's G7.3 two-flight synchronous final and Stage P's provisioned guard/fence functions, typed tails and evidence pruning behind `_head`, plus the C0′ results. Measurements ran on `sb4-pg/s1-wp`. No product or checked-in runner changes.

Configuration: **G6 `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`, default synchronous commit (arm S), shipped pipeline depth 2**. Arm E is off. This is the declared single-owner `ha=none` clock-qualified deployment, with the [G6 assumptions](../../../reports/20261024-g6/REPORT.md), and does not qualify arbitrary clock steps or HA.

Host `expo-build-450b`, verified through Tailscale; OS hostname `expose-builder-pixel-a`; Ryzen 5 3600, six physical/twelve logical CPUs. Native trial cohorts span 2026-10-26 22:30:09 UTC–2026-10-26 23:17:01 UTC.

Values are **highest passing offered writes/s · p50/p99 ms**, with median latency across all three repetitions at that rate. Passing requires intended-arrival p99 ≤100 ms, measured errors ≤0.1% and durable-counter equality against all acknowledgements including warm-up in every repetition. WIN means a strictly higher passing rate; a tie is not a win. Controls were not rerun: [controls](../results-20261024-s1-onehost-controls/README.md), [S1-WF](../results-20261026-s1-writes-wf/README.md), [2026-10-24 Snapback](../results-20261024-s1-onehost-final/README.md).

| Cell | Link | Best Supabase/Convex | S1-WF | 2026-10-24 G6 | WP G6 / S / depth 2 | vs control | vs WF | vs Oct 24 |
|---|---|---:|---:|---:|---:|:---:|:---:|:---:|
| W4 | A | 3,200 · 8.02/29.44 (Supabase) | 2,262 · 10.19/14.82 | 800 · 18.58/27.31 | 2,262 · 9.93/39.32 | LOSS | TIE | WIN |
| W4 | B | 1,600 · 9.36/17.91 (Supabase) | 2,262 · 12.68/53.05 | 800 · 23.48/31.31 | 1,600 · 10.80/17.73 | TIE | LOSS | WIN |
| W5 exact | A | 25 · 22.56/28.80 (Convex) | 1,600 · 11.12/14.97 | 800 · 20.27/29.29 | 2,262 · 15.59/68.55 | WIN | WIN | WIN |
| W5 exact | B | 70 · 8.07/8.82 (Supabase) | 800 · 11.85/15.52 | 141 · 23.45/34.11 | 70 · 23.13/30.88 | TIE | LOSS | LOSS |
| W5 nominal 1% mix | A | 800 · 7.20/13.89 (Supabase) | 800 · 8.92/26.90 | 1,131 · 19.48/27.25 | 2,262 · 10.32/46.96 | WIN | WIN | WIN |
| W5 nominal 1% mix | B | 1,600 · 9.30/14.33 (Supabase) | 1,600 · 11.49/47.28 | 800 · 24.30/33.82 | 1,600 · 11.06/19.99 | TIE | TIE | WIN |


Cells without a strict control win: W4/A LOSS (2262 vs 3200/s); W4/B TIE (1600 vs 1600/s); W5 exact/B TIE (70 vs 70/s); W5 mix/B TIE (1600 vs 1600/s).

Deltas against S1-WF: W4/A: 2262→2262/s (+0.0%); W4/B: 2262→1600/s (-29.3%); W5 exact/A: 1600→2262/s (+41.4%); W5 exact/B: 800→70/s (-91.2%); W5 mix/A: 800→2262/s (+182.8%); W5 mix/B: 1600→1600/s (+0.0%). These are observed ladder changes between historical runs, without a causal speedup claim.

The unchanged `s1-onehost.py --system snapback` runs only W4, W5 exact and nominal 1% hot-key mix on A/B. An outside-Git selector uses its existing explicit-rates interface to reproduce WF's double/halve search plus one geometric midpoint, starting at 3,200/s for W4/mix and 100/s for exact. Every cell also tests **2,262 / 3,200 / 4,525/s** with three repetitions; a pass at 4,525 extends upward in √2 steps. Already-tested cohorts are reused. All failures remain in the result; no failed repetition is replaced. The inherited W5-exact search can leave middle rates untested after a low-rate failure: the mandatory high rungs can reveal non-monotonicity but do not fill every gap. Any resulting low selected rate is a highest passing tested rate, not proof of a complete capacity ceiling. [Curves](./curves.json), [comparison](./comparison.json), [provenance](./provenance.json).

The method retains the validated 1M-message fixture, fresh service per cell, 32 open-loop writers/cap 32, fixed seeds, 10 s warm-up + 20 s measurement, three repetitions, and the exact archived S1-C native generator source rebuilt release without changes. PostgreSQL 16.15 keeps `fsync`, `synchronous_commit` and `full_page_writes` on. PG uses CPUs 0–2,6–8; app/proxy 3–4,9–10; generator 5,11. Link A adds 250 µs/direction and B 500 µs/direction. [Seed equality](./seed-equality.json), [generator source verification](./generator-source-verification.json), [affinity](./affinity.json), [deployment witnesses](./deployment-witness.json).

**Link B smoke ran first.** The rebuilt public-Queue helper confirms depth-two overlap for all three write shapes and independently verifies counter equality; its mean N and dispatch histograms are in [overlap smoke](./overlap-smoke.json). This auxiliary probe is a cloned fixture with direct engine contexts, 32 closed-loop clients, 256 warm-up + 1,280 measured attempts per workload; it is not an HTTP capacity result. Whole-cohort refusals are retained there. The HTTP smoke then qualifies **0/3 at 100/s** on B with the ordinary full windows. [Smoke receipt](./smoke-complete.json). All smoke failures are retained; counter equality alone does not qualify latency or error limits. The ladder continues under the unchanged qualification rules, and the failed low-rate smoke is a material caveat, not replaced by a successful retest.

| Cell | Link | Offered /s | Mean N† | Outstanding batches† | Flights/batch† | PG CPU µs/write | App CPU µs/write |
|---|---|---:|---:|---:|---:|---:|---:|
| W4 | A | 2262 | 7.92 | 1.32 | 2.000 | 239.3 | 481.4 |
| W4 | B | 1600 | 7.00 | 1.25 | 2.000 | 300.6 | 536.0 |
| W5 exact | A | 2262 | 9.31 | 1.13 | 3.000 | 237.4 | 430.1 |
| W5 exact | B | 70 | 1.12 | 0.04 | 3.000 | 2928.6 | 3247.6 |
| W5 nominal 1% mix | A | 2262 | 8.06 | 1.31 | 2.080 | 244.8 | 482.3 |
| W5 nominal 1% mix | B | 1600 | 7.09 | 1.23 | 2.071 | 306.0 | 535.8 |


† Queue and flight metrics come from **separate numeric trace probe cohorts at the selected native rate**, three complete 10 s/20 s repetitions per cell. Flights/batch counts the guarded data-flight transport wrappers in sampled batches; setup, cold prepares and untraced recovery controls are outside this census. Mean N weights all observed collection batches joined to successful measured requests equally, including nonpipeline batches; flights/batch weights only observed pipeline batches. These fields summarize different denominators; displayed values are medians of repetition means. Outstanding batches is the median **time-weighted number of dispatched, unreleased batches** over the measured arrival window. Dispatch histograms are separately retained and are not time-weighted concurrency. The main uninstrumented HTTP server does not expose these values. Probe measurements never determine capacity qualification.

PG/app CPU values come from an outside-Git 100 ms process sampler around each **native** trial, not from the trace probe. They divide whole-cohort CPU by whole-cohort acknowledged writes, including warm-up and drain/snapshot overhead. PG includes private-cluster background and observer CPU. App means server + shared delay proxy; [native CPU](./native-cpu.json) also separates server and proxy and gives repetition ranges. CPU ticks use process/start identities; short-lived processes between samples can be missed. This sampler was added outside the unchanged runner to expose the requested PG/app costs; WF did not have this supplemental sampler. Its observer overhead is not independently quantified. This is not an isolated measured-window or causal CPU ceiling measurement.

Numeric trace probes run a release build of a **copy of this current tree**, with only request/batch correlation and numeric timestamps added outside Git. The inherited diagnostic generator adds numeric client clocks and a correlation header. Production SQL, batching, deadlines, durability and release policy are unchanged. [Probe source delta hashes](./probe-manifest.json), [probe build](./probe-build.json), [per-cell metrics](./metrics.json). Complete numeric event streams and individual repetitions remain private.

Residence below is the pooled mean of successfully matched measured requests, in milliseconds. Where pipeline samples exist, their X/C/release split covers that subset; separately counted nonpipeline completions are excluded from those pipeline residence means. A wholly nonpipeline cohort instead reports its unsplit execution interval. **Q** is mailbox age before collection, **fill** remaining collection time, **X** collection end→final dispatch, **C** final dispatch→slot confirmation, and **release** confirmation→member continuation. HTTP other combines transport/intake, prequeue, response encode/write and client completion. Components reconcile per matched request. The pre-admission marker has no request ID, so intake→queue is retained as one combined interval; no separate admission/prequeue split is claimed. For W5 exact/B at 70/s, the pipeline residence split covers **903/4,200 successful measured requests (21.5%)**; 3,297 nonpipeline singleton completions are excluded. Mean N includes both paths, while displayed occupancy/flight and residence splits describe the pipeline. Every other row covers all successful measured requests. [Coverage and flight histograms](./diagnostics.json) disclose missing/unmatched requests; timings exclude failed/expired requests and do not replace intended-arrival SLOs.

| Cell / offered rate | Q | Fill | X | C | Release | HTTP other | Residence | Probe passes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W4/A 2262 | 1.884 | 0.005 | 2.280 | 4.649 | 0.073 | 0.364 | 9.255 | 0/3 |
| W4/A 3200 | 2.550 | 0.005 | 2.398 | 4.672 | 0.079 | 0.408 | 10.112 | 0/3 |
| W4/B 1600 | 2.384 | 0.007 | 3.157 | 5.329 | 0.200 | 0.467 | 11.544 | 1/3 |
| W4/B 2262 | 2.336 | 0.005 | 2.915 | 5.246 | 0.110 | 0.388 | 11.000 | 0/3 |
| W5 nominal 1% mix/A 2262 | 1.944 | 0.005 | 2.370 | 4.719 | 0.081 | 0.367 | 9.485 | 0/3 |
| W5 nominal 1% mix/B 1600 | 2.399 | 0.008 | 3.266 | 5.263 | 0.239 | 0.464 | 11.639 | 1/3 |
| W5 exact/A 2262 | 2.244 | 0.005 | 3.488 | 4.497 | 0.252 | 0.370 | 10.856 | 0/3 |
| W5 exact/B 70 | 8.066 | 0.004 | 3.967 | 4.919 | 0.090 | 0.356 | 17.403 | 3/3 |


The traced cohorts produce HTTP 503 admission/resource refusals under unchanged limits; 19/24 probe trials fail qualification. Their successful-request phase means are conditional on admission and must not be treated as native capacity evidence. Probe cost and shared-host run order can shift timings; no universal overhead correction is applied. The W4/A 3,200 and W4/B 2,262 diagnostic cohorts are retained regardless of whether their native or probe repetitions pass. The probe passes are shown separately. [Diagnostic qualification](./diagnostic-qualification.json).

Independent unchanged auditing covers **87 native trials / 4,011,720 measured intended arrivals**, including smoke. Independent durable-sum arithmetic checks **87 native write trials, 0 mismatches**. **50 native trials disqualify**: p99 50, errors 48, counters 0 (reasons overlap). All disqualified trial records remain in the private archive. Diagnostic auditing separately checks 24 trials, with 19 disqualified and zero counter mismatches. [Native audit](./audit.json), [counter audit](./counter-arithmetic-audit.json), [native disqualifications](./disqualified-summary.json), [diagnostic counter audit](./diagnostic-counter-audit.json).

All **8 native released starts** pass the inherited one-second rule of no unrelated process above one core; **0 busy observations** cause waits. Released 1/5/15-minute load ranges are 0.85–5.68 / 1.16–3.96 / 1.36–3.17. All **14 native HTTP before/after RTT captures** complete; maximum p99 is 1.188 ms. The inherited RTT rule requires completed captures, with no added absolute RTT threshold. Diagnostic cells have their own complete captures and affinity witnesses in the archive. Minimum observed `/home` free is **47.42 GiB**. A 0.5 s outer disk guard and build guards enforce 25 GiB; the unchanged runner retains its stricter 30 GiB checks. [RTT/load](./RTT-LOAD.md), [boundary records](./rtt-load.json), [disk](./disk.json).

All measured executables are immutable copies. The native product and seed helper are release builds from this tree in lane-owned `snapback4/target/s1-wp`; the seed's outside-Git manifest only points at this core and its own lockfile is refreshed offline. Native binary hashes match after both campaigns. Three out-of-tree probe setup attempts are rejected before measurement: a missing toolchain pin, an optional clock dependency in the compiler build core, and the core’s unsafe-code ban. The final probe copies the unchanged 1.97.0 pin, uses the existing safe clock API in the serving Postgres core and omits unused CPU/build-core metrics. All failed setup logs are archived. The unused public tiny_http TLS example key is excluded from the probe-source archive, documented in [exclusions](./probe-exclusions.json). [Build](./build.json), [binary integrity](./binary-integrity.json).

These are short-window serial observations on a shared host against historical controls and revisions. A clean start check does not reserve host resources throughout a trial. Non-monotonic results and coarse search rungs limit precision. Qualification is for this benchmark configuration and binary; it is not production capacity or publication qualification.

No fetch, push, stash, Git configuration change, paid resource or publication. Known-secret scans cover raw evidence and summaries before private sessions are removed, then the exact staged report blobs. Raw trials, histograms, resource samples and traces stay outside Git. **PIDs left: none.** Builds, probes, services, proxies, generators, observers, monitors, controllers and private PG are stopped, with PID/start identity and socket/pidfile checks. [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [secret audit](./secret-audit.json), [staged audit](./staged-secret-audit.json), [verification](./verification.json), [repository checks](./repository-checks.json).

Archive: `/home/ccheever/sb4scale/archive/s1-writes-wp-20261026.tar.gz`. **SHA-256: `10066f91f7baa71c121b82fea2b4db055d6e75f470020dbc93e35b08b8c3b3fe`**. It retains this lane's raw evidence, sources, build custody and all failures, plus the hash-verified WF archive, which embeds earlier Snapback/control evidence transitively. [Archive receipt](./archive.json).
