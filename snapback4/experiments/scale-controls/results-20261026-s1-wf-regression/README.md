# S1-WRG — WF write-regression diagnosis

**Neither reported W5 regression reproduces in the requested targeted, fixed-rung check.** Baseline `5fc6e6449b` and WF `55c44e465d` both pass **3/3 at 800, 1,131 and 1,600 writes/s** for exact W5/B and nominal 1% mix W5/A. The W4/B control improves: baseline fails 2,262/s **0/3**, WF passes **3/3**. These are tested rungs, not newly searched capacity ceilings.

**Native reproduction.** Each p99 entry below lists repetitions 0 / 1 / 2 in milliseconds; errors are measured-request counts. Every passing repetition has p99 ≤100 ms, errors ≤0.1%, and durable-counter equality with all acknowledged writes, including warm-up. Failures are retained.

| Cell | Offered/s | Baseline pass | Baseline p99 ms | Baseline errors | WF pass | WF p99 ms | WF errors |
|---|---:|:---:|---|---|:---:|---|---|
| W5 exact / B | 800 | 3/3 | 19.60 / 17.92 / 18.76 | 0 / 0 / 0 | 3/3 | 15.25 / 15.06 / 15.68 | 0 / 0 / 0 |
| W5 exact / B | 1,131 | 3/3 | 21.09 / 19.71 / 22.97 | 0 / 0 / 0 | 3/3 | 16.33 / 20.92 / 16.91 | 0 / 0 / 0 |
| W5 exact / B | 1,600 | 3/3 | 82.64 / 20.79 / 92.41 | 1 / 0 / 0 | 3/3 | 18.48 / 18.22 / 18.24 | 0 / 0 / 0 |
| W5 nominal 1% mix / A | 800 | 3/3 | 18.74 / 15.43 / 17.10 | 0 / 0 / 0 | 3/3 | 11.94 / 18.06 / 11.69 | 0 / 0 / 0 |
| W5 nominal 1% mix / A | 1,131 | 3/3 | 14.60 / 37.45 / 14.43 | 0 / 0 / 0 | 3/3 | 16.49 / 11.80 / 13.42 | 0 / 0 / 0 |
| W5 nominal 1% mix / A | 1,600 | 3/3 | 60.46 / 20.53 / 15.58 | 0 / 0 / 0 | 3/3 | 12.71 / 14.86 / 37.85 | 0 / 0 / 1 |
| W4 / B | 800 | 3/3 | 18.69 / 15.23 / 16.29 | 0 / 0 / 0 | 3/3 | 13.12 / 13.67 / 13.14 | 0 / 0 / 0 |
| W4 / B | 1,131 | 3/3 | 15.74 / 42.76 / 16.63 | 0 / 0 / 0 | 3/3 | 13.93 / 14.48 / 14.84 | 0 / 0 / 0 |
| W4 / B | 1,600 | 3/3 | 18.04 / 17.17 / 31.44 | 0 / 0 / 0 | 3/3 | 15.17 / 14.70 / 15.01 | 0 / 0 / 0 |
| W4 / B | 2,262 | 0/3 | 1018.17 / 1017.64 / 1017.12 | 6600 / 6141 / 5387 | 3/3 | 17.56 / 84.21 / 20.35 | 1 / 6 / 3 |

Medians across three native repetitions at the key rungs:

| Cell · offered/s | Baseline p50 / p99 ms | WF p50 / p99 ms |
|---|---:|---:|
| W5 exact / B · 1,131 | 14.14 / 21.09 | 12.65 / 16.91 |
| W5 exact / B · 1,600 | 15.79 / 82.64 | 13.88 / 18.24 |
| W5 nominal 1% mix / A · 1,600 | 10.99 / 20.53 | 9.18 / 14.86 |
| W4 / B · 2,262 | 1008.21 / 1017.64 | 12.26 / 20.35 |

**Bisection disposition.** No W5 rung passes the baseline 3/3 and fails WF qualification. The requested conditional bisection is therefore not measured. All three temporary ablations were prepared and release-built during fixture setup, but no performance result or causal ranking is assigned to them: (1) disable two-flight eligibility, retaining separate tail/COMMIT; (2) restore the previous polling release loop and remove notifications; (3) revert the context/image/callback moves and materialized payload parsing. Their sources, patches and distinct verified binary hashes are in the private evidence archive. No product source is committed.

**Method.** Host `expo-build-450b` (OS hostname `expose-builder-pixel-a`), Ryzen 5 3600, six physical/twelve logical CPUs; worktree `~/projects/sb4-s1sk`. The two product commits are parent and child. Builds use release optimization, default assertions and the `postgres` feature, with isolated lane target directories `snapback4/target/s1-wrg-baseline` and `snapback4/target/s1-wrg-wf`; binaries are copied to immutable paths before load. Native WF SHA-256 is `55a902f254ee561ce5fbc1920747b5c2365986e651185b5c6c3f65b24053437e`, identical to the previous WF report’s binary. Native baseline SHA-256 is `7665aa4f37bf166b68cdd062bea08e13d6e8d64299ecce5eb3250a67a50538f9`. The exact retained S1 generator SHA-256 is `a6d68a4d3e0a048158670527a18d6420ab368d36dfc3d7011a6782793dbddea9`.

The unchanged one-host runner and generator use 1M messages, 32 clients/cap 32, 10 s warm-up, 20 s measurement and three repetitions per rung. Each cell starts a fresh service. Rates ascend 800 → 1,131 → 1,600, with 2,262 added for W4/B. Per workload, baseline precedes WF; order is exact/B, mix/A, W4/B. The ordinary runner shares its private fixture across cells. This is a targeted explicit-rates check, not a reconstruction of the old full-matrix/search prefix.

PostgreSQL 16.15 retains the repository’s configuration delta with `fsync`, `synchronous_commit` and `full_page_writes` on. Product configuration is default synchronous S, adaptive batches, default pipeline depth two and `ha=none`, with `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`. No E mode. PostgreSQL uses CPUs 0–2,6–8; app/proxy 3–4,9–10; generator 5,11. A adds 250 μs per direction and B 500 μs per direction. Authorization, Quarry, deadlines, load scheduling, caps and qualification are unchanged.

**Historical evidence and limits.** The [old WF report](../results-20261026-s1-writes-wf/README.md) compared against [levers](../results-20261025-s1-writes-levers/README.md), whose product was `7e88aa041d`, rather than this lane’s requested parent `5fc6e6449b`. In its retained raw trials, exact/B at 1,131/s fails with p99 **1,006.11 / 389.28 / 189.01 ms**; mix/A at 1,600/s records **32.85 / 203.03 / 22.33 ms**, so one repetition disqualifies the whole mix rung.

Old exact/B/1,131 whole-cohort snapshots show zero PostgreSQL deadlocks in all three repetitions. Timestamp-matched PG logs contain **10 / 8 / 4 statement-timeout errors** in those cohorts, including warm-up. The old mix/A/1,600 cohorts have no PG ERROR records despite the failed middle repetition. This evidence does not establish one shared failure mechanism for both cells or identify one of WF’s three parts.

Workload history is measurably different: immediately before exact/B/1,131 repetition 0, the old WF counter total is **2,823,245**, versus **72,038** for this baseline and **389,861** for this WF. These are counter totals, not commit-table row counts. Full prior search/load history is not replayed here. A start-load check also does not reserve a shared host throughout a trial. The original stalls’ initiating cause remains unisolated; assigning them to WF from these results would be unsupported.

**Stage attribution.** The 36 additional diagnostic trials use the same timings, rates/order, clients, SLO and fixture image, with numeric clocks in outside-repository copies of both cores and the generator. They restore the hash-verified pre-load native fixture, copy its release/session files unchanged, and reuse its original front socket so the product’s deployment binding is not rewritten. A private PG16 session-preload library records numeric executor/ticket/commit clocks. The generator differs from retained S1 source only in its package/lock metadata and load-clock code. These timings are diagnostic, not capacity results.

Instrumentation perturbs timing/admission: **32/36 probe trials pass**, including a baseline exact/B/1,600 cohort that fails 0/3 despite the native baseline passing 3/3. Keep the native table as the reproduction result. At the two originally regressed rungs below, every successful measured request reconciles end to end: baseline exact **67,856/67,856**, WF exact **67,860/67,860**, baseline mix **95,995/95,995**, WF mix **96,000/96,000**. The baseline’s four exact and five mix measured HTTP refusals have no server trace; their internal request stages are not inferred. Two auxiliary baseline exact/B/1,600 repetition-2 successes lack a pipeline batch-clock match and are excluded from its stage averages; the originally regressed rungs above have complete success matching.

The following are pooled **successful-request mean milliseconds**, with each request’s components reconciling to its HTTP residence. `Q` is mailbox age before collection; fill is remaining collection time; `X` is collection end→final dispatch, including prefetch flights and ordered interpretation; `C` is final dispatch→slot confirmation; release is confirmation→that member’s continuation. HTTP is the remaining intake/admission/encoding/transport work. Generator dispatch lag is separate.

| Diagnostic cell | Q | Fill | X | C | Release | HTTP remainder | HTTP residence |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact/B · 1,131 · baseline | 3.223 | 0.008 | 5.129 | 6.400 | 0.420 | 0.382 | 15.562 |
| exact/B · 1,131 · wf | 2.850 | 0.007 | 5.001 | 5.189 | 0.522 | 0.385 | 13.952 |
| mix/A · 1,600 · baseline | 2.513 | 0.008 | 3.039 | 5.952 | 0.185 | 0.381 | 12.077 |
| mix/A · 1,600 · wf | 2.185 | 0.007 | 2.910 | 4.872 | 0.214 | 0.378 | 10.565 |

**Batch size and overlap.** N is actual dispatched invocation count inside the common measured arrival windows. Histograms use buckets **1 / 2–4 / 5–8 / 9–16 / 17–32**. The depth histogram is **one / two outstanding unreleased batches at dispatch**. Physical and unreleased percentages are time-weighted **0 / 1 / 2** distributions; they measure different intervals from dispatch depth.

| Diagnostic cell | Mean N | N histogram | Dispatch-depth histogram | Physical finals % | Unreleased finals % |
|---|---:|---|---|---|---|
| exact/B · 1,131 · baseline | 6.83 | 0 / 20 / 9694 / 212 / 5 | 0 / 9931 | 4.66 / 85.38 / 9.96 | 0.00 / 89.30 / 10.70 |
| exact/B · 1,131 · wf | 6.12 | 0 / 65 / 10902 / 106 / 12 | 0 / 11085 | 7.00 / 90.42 / 2.59 | 0.00 / 96.62 / 3.38 |
| mix/A · 1,600 · baseline | 7.44 | 2 / 14 / 11002 / 1880 / 10 | 0 / 12908 | 0.35 / 72.07 / 27.58 | 0.00 / 71.42 / 28.58 |
| mix/A · 1,600 · wf | 6.47 | 1 / 83 / 14033 / 713 / 12 | 0 / 14842 | 1.68 / 77.02 / 21.30 | 0.00 / 77.53 / 22.47 |

Every measured dispatch samples depth two. Physical two-final overlap is only **9.96→2.59% for exact** and **27.58→21.30% for mix**, baseline→WF. WF also dispatches smaller mean batches at these fixed offered rates. These observations establish actual overlap and phasing; they do not establish a capacity ceiling.

**Flights and their wall times.** Exact W5 has a dependent level flight: **four flights/batch on the baseline, three on WF**. The fixture’s null-owner counter requires membership authorization through its immutable room; this source-backed dependency explains the counted extra level. Mix batches use baseline **three/four** and WF **two/three** flights. Thus G7.3’s two-flight level-zero budget does not cover every exact-W5 batch. Flight histogram counts below use batches containing matched measured successes, including boundary batches; N/depth histograms above use dispatch-window membership.

| Diagnostic cell | Flights: batch counts | P1 mean ms | Extra level mean ms when present | Tail mean ms | Separate COMMIT mean ms |
|---|---|---:|---:|---:|---:|
| exact/B · 1,131 · baseline | 4: 9,933 | 2.162 | 1.487 | 2.450 | 3.835 |
| exact/B · 1,131 · wf | 3: 11,088 | 2.175 | 1.469 | 5.107 | combined in tail |
| mix/A · 1,600 · baseline | 3: 11,948, 4: 960 | 1.775 | 0.874 | 2.500 | 3.341 |
| mix/A · 1,600 · wf | 2: 13,885, 3: 960 | 1.759 | 0.882 | 4.770 | combined in tail |

WF’s tail entry includes its co-dispatched synchronous COMMIT. P1/level flights are nested within X; tail/COMMIT are nested within C, so these tables are not added to each other. Both physical writer-slot mappings have **100% agreement** from unambiguous PG-tail witnesses in every repetition. Using those stable mappings, every matched batch has exactly one observed data commit.

| Diagnostic cell | Ticket wall mean ms | PG tail CPU mean ms | PG commit callback wall mean ms | Already-confirmed-before-poll mean ms |
|---|---:|---:|---:|---:|
| exact/B · 1,131 · baseline | 0.076 | 0.572 | 2.655 | 0.288 |
| exact/B · 1,131 · wf | 0.038 | 0.301 | 2.704 | 0.391 |
| mix/A · 1,600 · baseline | 0.506 | 0.679 | 2.663 | 0.017 |
| mix/A · 1,600 · wf | 0.267 | 0.324 | 2.644 | 0.070 |

Ticket timing includes the advisory-lock call’s CPU, and PG executor timings cover completed calls. Commit callbacks run from XID-bearing PRE_COMMIT through COMMIT, including synchronous flush. The combined WF final shortens C from **6.400→5.188 ms exact** and **5.952→4.872 ms mix**. PG tail CPU roughly halves. Mean confirmation-to-continuation release changes **0.420→0.522 ms exact** and **0.185→0.214 ms mix**. This paired attribution does not rank the three WF parts independently.

**Aborts, reruns and cascades.** At both originally regressed rungs, both trees have **zero original-final failures, zero physical member retries, zero speculative conflict-validation reruns and zero cascades**, over the three complete probe cohorts including warm-up. Exact hot targets are recognized before speculation and executed in order: baseline **101,775 ordered / 2 speculated members**, WF **101,785 / 2**. Mix records **143,991 / 143,997 speculated members**, baseline/WF, with zero ordered hot-target skips. The [wave selector](../../../crates/snapback4-core/src/engine/committer/wave.rs) keeps repeated known writes ordered, so hot-key contention is not itself a measured transaction-abort cause here.

One auxiliary probe exception occurs at **baseline mix/A, 1,131/s, repetition 2**: two affirmatively aborted originals, zero unknown finals, one 16-member cascade fallback, and 26 measured refusals after program queueing plus one refusal without a trace. One reason decodes exactly to **“program invocation’s remaining deadline elapsed after tail”**. The follower’s dynamic Store message is retained only as numeric hash `10531632095524900697`; its exact text cannot be recovered from the numeric-only trace. Recovery is observed after the predecessor abort, without changing original deadlines. No speculative conflict rerun or additional physical member attempt is recorded. This probe-only exception is separate from the native W5 result.

**p99 contributors.** Each repetition’s slowest 1% of matched successful measured requests is selected by corrected latency from intended arrival. The table pools those selected sets and reports **mean components**, not a sum of marginal p99s and not the corrected p99 itself. HTTP remainder includes fill, intake/admission, response and transport.

| Diagnostic cell | Generator dispatch | Q | X | C | Release | HTTP remainder | Corrected total ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| exact/B · 1,131 · baseline | 20.814 | 10.351 | 6.087 | 12.996 | 0.563 | 0.636 | 51.448 |
| exact/B · 1,131 · wf | 21.441 | 10.012 | 6.332 | 9.041 | 1.349 | 0.808 | 48.983 |
| mix/A · 1,600 · baseline | 45.301 | 6.005 | 3.763 | 11.071 | 0.311 | 0.670 | 67.120 |
| mix/A · 1,600 · wf | 24.374 | 5.712 | 3.993 | 10.585 | 0.458 | 0.768 | 45.891 |

**Cause and recommendation.** The initiating cause of the historical stalls remains **unisolated**. The requested parent/WF fixed-rung comparison shows no W5 regression, and the clocks show a shorter WF final, a remaining dependent fetch/ordered hot-write path, and appreciable generator dispatch delay in the far tail. Those facts do not justify assigning the old failures to two-flight finalization, CPU moves or notification release.

**Keep WF enabled.** The concrete measurement fix is to run each parent/candidate cell from independent clones of the same validated pre-trial fixture, alternate pair order, and keep fixed-rung outcomes separate from search ceilings while retaining the existing SLO/error/counter rules. Replaying the old full search prefix separately is the next experiment for the historical timeout episode. No product rollback or tuning change is supported by this lane.


**Verification, load and custody.** The unchanged auditor checks **60 native + 36 diagnostic trials / 2,390,040 measured intended arrivals**, including arrival accounting, histogram counts/lossless stdout, per-repetition SLO/error/counter verdicts and summaries. Independent before/after arithmetic checks all **96 counter deltas against whole-cohort acknowledgements: zero mismatches**. Native qualification is 57/60, with the three failures confined to baseline W4/B/2,262; probe qualification is 32/36. No failed repetition is replaced.

All **10 released cell starts** pass the one-second no-unrelated-process-above-one-core rule; **0 busy observations**. Released 1/5/15-minute load ranges are **0.96–4.11 / 1.84–4.47 / 2.38–4.04**. The archive also retains a one-second load/CPU-pressure/I/O-pressure series. All **20 before/after RTT captures** complete 1,000 queries each; maximum capture p99 is **1.143 ms**. The inherited rule adds no absolute RTT threshold.

Live witnesses verify all **10 service/PG/proxy thread-mask snapshots** and their actual service executable hashes. All **60 native generator thread censuses** pass; all **36 probe generator process masks** are 5,11. The inherited observer recognizes the native executable name and does not produce an independent all-thread census for the renamed probe generator; its process mask and unchanged thread-affinity code are retained. All **41 runner source files** match their pre-run hashes.

Minimum recorded `/home` free space is **62.36 GiB**, above the requested 25 GiB floor and the runner’s stricter 30 GiB floor. Both owned Cargo target directories are deleted. The immutable measured executables, exact effective probe/ablation patches, source hashes, clocks, all trial failures, build records, affinity/load/RTT observations and auditors remain outside Git.

Cohort snapshot boundaries: matrix: 2026-10-26 12:27:18 UTC–2026-10-26 12:59:08 UTC; attribution: 2026-10-26 13:01:17 UTC–2026-10-26 13:20:20 UTC.

Setup attempts are retained: a missing controller-wait log before seeding, ambient Rust 1.94 rejection for an outside-tree probe, a missing Postgres feature guard in a probe error clock, and a partial cleanup-file read at phase handoff were corrected before their dependent measurements. Cargo also reused one ablation artifact across different source copies; this was detected before any trial used an ablation, rejected, and fixed by invalidating the workspace-package artifacts between builds. Final ablations have distinct hashes and protocol-string witnesses. The native WF binary matches the earlier WF binary exactly.

Known-plaintext-secret scanning checks **259 values / 13,995 files with zero hits** before removing both private runtime directories. **7,505 recorded PID/birth identities have no remaining live process**; both PG sockets/pidfiles are absent, and all benchmark/build/controller/observer processes have stopped. **PIDs left: none.** The exact staged README also passes a known-secret fingerprint scan.

Repository verification is report-scoped: source/binary custody, independent counters/qualification, report readback, whitespace and reference checks. This is not publication qualification or a complete product-suite claim. This lane performs no fetch, push, stash, Git configuration change, publication or paid-service operation. **Only this README is committed.**

Private archive: `/home/ccheever/sb4scale/archive/s1-wf-regression-20261026.tar.gz`.

**SHA-256: `bef29bb379cd3949e4927ceb3ce6da671f7746c61c311a3d2ef2f1b77d8b4b65`**.
