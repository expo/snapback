# S1-R9: R8 diagnosis and SPR9 competitive campaign

Candidate **9ada6771e6**, same-binary flag-off main, Supabase and Convex, on expo-build-450b. All reported qualification is for the declared prewarmed workload. Product code is unchanged.

## Part 1: R8 collapse and the repaired setup

The R8 collapse is **a product cold-admission/void feedback defect exposed by a benchmark setup mismatch**, not a throughput limit or a missing-index compatibility failure. This report supersedes the capacity interpretation of [S1-R8](../results-20261027-s1-r8-authoritative/README.md), while preserving that report and all its failed measurements. No product code was changed. The setup repair primes every worker key through each system’s authenticated mutation API before measurement. The resulting campaign qualifies a prewarmed workload; it does not qualify cold-key admission or fix the defect.

450a’s SPR8 `Service.prime` sends 32 sequential authenticated increments to distinct worker counters before W4, and 64 before hot1: 32 distinct plus 32 shared-counter identities. S1’s existing native probe sends 70 serial increments to one worker’s counter (110 operations for hot1), leaving 31 distinct worker keys cold. All arms in the repaired screen and SPR9 campaign receive the additional full-key prime outside the timing and counter windows. Each measurement still starts a fresh service. Reads receive no mutation primer.

The initiating work is serialized cold-fact loading under the owner. In the cold G5 control, 32 warm misses took 17.86 ms each on average. Admission then waited about 163.44 ms on average, beyond the original 100 ms invocation deadlines. With parallel preparation, SPR8 allocates the sequence and footprint holds before the off-owner encoder rejects the expired deadline. Every such rejection now needs a durable void. Polling performs void/head/retention work under the same owner, maintaining the admission delay. The observed cold control has 5,169 `reject_deadline`, `void`, and `retry_expired` events apiece, but only 91 flights including setup. This is failed-reservation amplification divided by very few successful ACKs, rather than 100× more SQL for an ordinary successful write.

Source comparison supports the regression mechanism: older R0 `ad1bfc1839` checks the original deadline before `self.next += 1`; SPR8’s parallel preparation allocates first and can reject in encoding later. The source ordering, profile counts and priming counterfactual agree. A separate serial-preparation performance counterfactual was not run, so the source-level causal attribution is narrower than a tested product fix. SPR9 inherits this area; this campaign does not establish its cold-key behavior.

Five diagnostic cohorts were retained, followed by the independent native screen. The diagnostic cohorts use a 0.2 s `pg_stat_activity` observer and before/after statistics; profiled controls also enable product collectors. They cannot substitute for native qualification. The first primed G6 diagnostic still missed p99 despite eliminating all errors; it remains a failure.

| Diagnostic | G6 | Primer | Intended p99 ms | Sent mean upper estimate ms | ACKs including warm-up | Measured errors |
|---|---|---|---:|---:|---:|---:|
| Fresh R8 W4/A 3,805 | on | original single-key probe | 1,290.797 | 181.060 | 195 | 75,971 |
| Same fixture/binary W4/A 3,805 | on | all 32 keys | 122.814 | 6.023 | 114,150 | 0 |
| Independent cold W4/A 3,805 | off | original single-key probe | 1,212.154 | 191.936 | 21 | 76,090 |
| Independent primed W4/A 3,805 | off | all 32 keys | 79.299 | 6.392 | 114,150 | 0 |
| Primed hot1/B 3,200 | on | 32 distinct +32 shared identities | 39.911 | 6.667 | 96,000 | 0 |

“Sent mean” sums HDR bucket upper bounds and divides by sent attempts; intended-arrival histograms include unsent expirations. The cold G6 run’s measured errors were 72,563 `expired_before_send` and 3,408 HTTP 503; cold G5 had 72,766 and 3,324. The service logs do not emit a per-request refusal reason for every 503. `reject_deadline`/`retry_expired` profile counts and source mapping identify the local deadline/void mechanism; no nonexistent per-503 log classification is claimed. There was no observed O fallback explaining the collapse. Low loan occupancy follows because little work survives admission to reach R’s data-flight stage.

### Fixture and environment comparison

The fresh 450b fixture is a full one-million-message `Engine::seed_at` image with complete equality witnesses. Candidate deployment precedes seeding. The frozen old seed helper leaves the candidate-created columns and indexes unchanged. A newly built R8 helper also opens that same store without changing the catalog. The required `r(t,id)` primary key, `_commits(seq)` and `_change_evidence(seq)` indexes exist. R8 serving restores the two-image `orev`, `owm`, `odata` columns; the seven enriched attempt columns and `_spike_retention` table/index are present. The cold run has zero `bench.r` sequential scans. This falsifies the proposed absent-index/old-helper schema mismatch as the cause in this fixture.

450a’s initial R fixture was cloned from an Engine-seeded image using `CREATE TABLE LIKE INCLUDING ALL` and row copies, omitting `_commits`, `_change_evidence`, `_log` and `_ops`, resetting the head/revision offset and removing flight metadata before R restoration. Its initial clone receipt records 48 indexes and 1,011,266 `r` rows, including one million messages and 257 counters. The fresh candidate-deployed 450b image had 49 indexes before R restoration. Those initial counts do not prove identical final SPR8 catalogs; the report does not infer a post-open 450a catalog from an earlier clone receipt. The critical restored schema/indexes and cold-run scan evidence above are direct 450b observations.

The R8 engine module SHA-256 matches 450a (`71916a0e4e8bc38957a65242605712b70dabc209104d1f97f94aa896f73dabba`), as do the selected non-diagnostic R flags and release/Postgres feature choice. 450a left the G6 bound unset, while S1 enables `1000,250`; the cold G5 control independently fails and the primed G6 screen passes, so G6 is not the initiating cause. There is no evidence of a missing/mistyped R flag or build-feature difference causing the collapse.

The exact R8 selected flags and their distinction from SPR9’s later selections are recorded in [METHOD.md](./METHOD.md).

The cold fresh run inserted 5,214 voids and 195 new committed mutations. Its WAL was 3,685,740 bytes, 39,771 records, 19 FPIs and 7,307 syncs: 18,901 B and 37.47 syncs per ACK. Priming reduced this to 1,877 B and 0.0971 syncs per ACK, with zero additional voids. The latter cohort produced 14,175 FPIs and 214 MB total WAL. Those images represent 116 MB of uncompressed 8 KiB pages; actual physical image bytes were not decoded and can differ because of page holes/compression. Relation, checkpoint and page-allocation attribution was not resolved, so the total is not an intrinsic logical-tuple encoding estimate. FPIs do not explain the original cold run’s amplification: that run had only 19.

SQL, table/index and wait witnesses are summarized in `part1-statistics.md`. Statement times use `pg_stat_statements.track=all`: nested and top-level times overlap and must not be summed. Calls, rows and buffer deltas cover the whole diagnostic observation cohort and divide by ACKs from the matching warm-up-plus-measurement cohort. The observer’s own SQL is excluded by app role. The tiny metadata relations have many intentional scans; the large row table does not. `pg_stat_user_tables` tuple deltas can include asynchronous statistics publication and the surrounding settle/snapshot operations; they are not substituted for the exact durable counter check.

### Part 1 database cost comparison

PG CPU covers the whole sampled cohort and divides by all ACKs, including warm-up. Failed cohorts include voids/refusals and surrounding maintenance; their per-ACK figures are not the intrinsic cost of a successful write. Diagnostic collectors and the SQL observer are enabled only in the diagnostic rows. Native screen rows show medians across three separately normalized repetitions.

The resource sampler and SQL observer use separate WAL snapshot brackets. For cold G6, the resource window is 33.152 s (3,501,767 B), whereas the diagnostic SQL window above is 43.681 s (3,685,740 B), including additional pretrial quiet time. Both divide by the same 195 ACKs; the two per-ACK WAL figures are not interchangeable.

| Cohort | PG CPU ms/ACK | WAL B/ACK | Syncs/ACK |
|---|---:|---:|---:|
| Cold G6 diagnostic | 65.436 | 17957.779 | 37.077 |
| Primed G6 diagnostic | 0.504 | 1875.749 | 0.096 |
| Cold G5 diagnostic | 610.476 | 216438.714 | 331.286 |
| Primed G5 diagnostic | 0.499 | 908.739 | 0.092 |
| Primed hot1/B G6 diagnostic | 0.540 | 1087.397 | 0.110 |
| Native W4/A 3,805 screen | 0.509 | 962.629 | 0.095 |
| Native hot1/B 3,200 screen | 0.551 | 891.841 | 0.113 |

### Required native three-repetition screen

G6 is on, all product diagnostic collectors and the extra SQL/wait observer are off, and the unchanged quiet gate, contamination census, native counter checks, fresh service and 10+20 s windows apply. R8 and Supabase are interleaved per repetition; both receive full-key priming. All six R8 repetitions have zero measured errors and exact durable counters.

| Cell | R8 passes | R8 p99 ms by repetition | Supabase passes |
|---|---:|---|---:|
| W4/A 3,805 | **3/3** | 25.739, 74.187, 11.690 | 0/3 |
| W5 hot1/B 3,200 | **3/3** | 51.872, 52.265, 8.430 | 0/3 |

Both exceed the required 2/3 screen threshold, authorizing Part 2. This screen is not the five-repetition competitive verdict.

### Product ticket draft (record only; no product fix or separate issue was landed)

**Title:** SPR8 parallel preparation can sustain a cold-key deadline/void admission spiral.

**Reproduction:** On restored R0 `6c0fe17c6e`, release/Postgres, queued HTTP, 29 data loans, cap 32, direct dispatch and parallel prepare, start a fresh service over the full S1 image. Prime only one counter as the ordinary S1 probe does, then run 32 distinct authenticated writers at W4/A 3,805/s, 10 s warm-up +20 s measured. Repeat with G6 disabled. Both configurations collapse; sequentially priming all 32 keys before load removes the collapse. Preserve all original deadlines, counters, prefix ordering, holds and void/recovery semantics.

**Observed:** Roughly 18 ms serialized cold loads push admission beyond 100 ms. Thousands of expired reservations require durable voids and head/retention work, while successful data flights almost stop. Example: 195 ACKs, 5,214 voids, 75,971 measured errors, p99 1.291 s; G6-off similarly fails. This is a production cold-start/overload-recovery defect even though benchmark priming can hide it.

**Expected/acceptance:** Cold admission and recovery from overload must not create a self-sustaining late-reservation loop. Reject work before irreversible reservation where protocol permits, or otherwise bound and drain its cost while preserving dense reservations, durable void arbitration, ordered ACKs and deadlines. Add a product-level cold-key and recovery witness with G5/G6 and parallel preparation; require eventual healthy throughput without an external sequential primer. Do not accept a primer as the product repair. Exact implementation is deliberately left to the product lane.

## Part 2: competitive results

Native cohort period: **2026-10-28 05:27:56 UTC through 2026-10-29 13:21:33 UTC**. This span includes intervening quiet/setup periods; systems are interleaved within each repetition. Diagnostic and one-CPU periods are recorded separately in verification.json.

Six write cells strict wins over both advocates: **3/6**. A tie, loss or untested comparison fails the competitive write gate. The three-repetition read screen does not establish the RFC’s five-repetition read gate; no automatic R1–R5, default-on or universal performance authorization follows.

| Cell | SPR9 qualified / first failing | Supabase qualified / first failing | vs Supabase | Convex qualified / first failing | vs Convex |
|---|---|---|---|---|---|
| W4-disjoint-A | 3,200 / 3,805 | 3,200 / 3,805 | **tie** | direct failure bound / 3,200 | **strict win** |
| W4-disjoint-B | no qualified pass / 4,525 | 2,262 / 3,200 | **untested** | 565 / 800 | **untested** |
| W5-hot1-A | 3,200 / 3,805 | 3,200 / 3,805 | **tie** | 565 / 800 | **strict win** |
| W5-hot1-B | 3,200 / 4,525 | 2,690 / 3,200 | **strict win** | 565 / 800 | **strict win** |
| W5-same-A | 1,600 / 2,262 | 200 / 282 | **strict win** | 35 / 50 | **strict win** |
| W5-same-B | 1,131 / 1,600 | 200 / 282 | **strict win** | 25 / 35 | **strict win** |

Qualification includes all clean capacity observations at a rate, including later paired controls; each deciding block predeclares five repetitions. A selected repetition that remains ineligible after its one noise retry leaves the rate inconclusive, even when another block at that rate passed 5/5. [All phase/rate pass tables](./PASS_TABLES.md) retain original pins, allowed reruns, extra controls, per-repetition sent means and error/counter results. [Aggregate data](./aggregate-rates.json) contains scalar summaries only. W4/A’s Convex direct bound is not a zero-capacity claim. Missing upper bounds remain untested.

Candidate capacity observations still ineligible after their one noise retry:

| Cell / rate | Phase | Retained attempts | Unrelated CPU over one core, cumulative s per attempt |
|---|---|---:|---|
| W4-disjoint-B / 3,200 | repeat-control | 2 | 2.997, 2.986 |

These observations are not product capacity failures. Their unresolved eligibility prevents a qualifying claim; later clean controls do not replace them.

**W4-disjoint-A quarter ruling:** headline tie at 3,200; both tied arms fail the next headline. The 3,805 quarter rung is reported beside that tie, with ruling 9’s adoption-after-results disclosure. Its observed comparison is the verdict above; latency/CPU/WAL do not break ties.

**W5-hot1-A quarter ruling:** headline tie at 3,200; both tied arms fail the next headline. The 3,805 quarter rung is reported beside that tie, with ruling 9’s adoption-after-results disclosure. Its observed comparison is the verdict above; latency/CPU/WAL do not break ties.

### Pinned advocate checks and the single allowed rerun

All checks assert the pinned S1-C binary, initial full image equality, effective settings and affinity. No advocate tuning changed. The second full block stands; original failures remain visible.

| Cell / system | Pin /s | Original passes | Rerun passes |
|---|---:|---:|---:|
| W4-disjoint-A / supabase | 3200 | 4/5 | 5/5 |
| W4-disjoint-B / supabase | 2262 | 9/10 | 5/5 |

Convex high-rung omissions and advocate frontier decisions are in [the skipped-rung summary](./skipped-rungs.json). Each omission records the already observed lower failure or completed comparison; no skipped point is counted as a measured pass.

### Exact reference and challenges

The 1,131/s reference has two five-repetition blocks declared before either starts. Main failing makes that reference comparison inconclusive; it does not excuse any candidate failure or lower the reference.

| Link | SPR9 at 1,131 | Main at 1,131 | Verdict | p50 R9/main ms | p99 R9/main ms |
|---|---:|---:|---|---|---|
| A | 10/10 | 10/10 | **PASS 10/10** | 10.154 / 10.174 | 17.842 / 16.425 |
| B | 10/10 | 10/10 | **PASS 10/10** | 12.784 / 12.612 | 21.987 / 19.440 |

Exact A additional paired controls at 1,131/s: SPR9 30/30, main 30/30. They are outside the two declared blocks and remain effective; a clean candidate miss there is not erased by 10/10 in the declared blocks.

Exact B additional paired controls at 1,131/s: SPR9 15/15, main 15/15. They are outside the two declared blocks and remain effective; a clean candidate miss there is not erased by 10/10 in the declared blocks.

| Link / challenge | SPR9 | Main | p50 R9/main ms | p99 R9/main ms |
|---|---:|---:|---|---|
| A / 2,096 | 5/5 | 5/5 | 11.575 / 11.461 | 84.607 / 34.374 |
| B / 1,678 | 5/5 | 5/5 | 14.115 / 14.246 | 26.427 / 23.904 |

Matched native exact deciding points, in addition to the fixed reference and challenges:

| Link / deciding rate | SPR9 | Main | Ineligible SPR9 / main |
|---|---:|---:|---:|
| A / 1,600 | 5/5 | 5/5 | 0 / 0 |
| A / 2,262 | 4/5 | 3/5 | 0 / 0 |
| B / 1,600 | 4/5 | 5/5 | 0 / 0 |
| B / 2,262 | 0/5 | 0/5 | 0 / 0 |

**Higher exact-rung regression on B at 1,600/s:** main passes every matched deciding observation while SPR9 has a clean miss. A passed 1,131/s reference does not erase this result.

The challenges are supplementary observations, not inferred ceilings or new quarter rungs. [Candidate failures](./candidate-failures.json) retain p99, dispatch/HTTP components, error classes, counter and terminal-service flags; those quantiles do not establish a per-request WAL timeline.

SPR9 exited with `E_STORE_OWNERSHIP` in retained native failures: 0564-W5-same-A-headlines-r9-2262-rep2 (6 ACKs, durable counter equal; rollback or durability recovery was not confirmed); 0683-W5-same-B-headlines-r9-1600-rep2 (3 ACKs, durable counter equal; rollback or durability recovery was not confirmed). Terminal exit makes these repetitions fail regardless of a small request-error latency. Named log-code counts are occurrences in service stderr, not a classification of every refused request.

### Reads and low-rate writes

G6 bounds are 1000,250 on both native arms. Reads are the explicitly commissioned three-repetition non-regression screen, not the formal five-repetition gate.

| Cell | Rate /s | SPR9 | Main | Verdict | p50 R9/main ms | p99 R9/main ms |
|---|---:|---:|---:|---|---|---|
| W1-disjoint-A | 8,000 | 3/3 | 3/3 | PASS 3/3 | 1.544 / 1.523 | 16.204 / 6.074 |
| W1-disjoint-B | 8,000 | 3/3 | 3/3 | PASS 3/3 | 2.230 / 2.187 | 10.068 / 9.830 |
| W2-disjoint-A | 11,313 | 3/3 | 3/3 | PASS 3/3 | 0.206 / 0.208 | 20.120 / 19.694 |
| W2-disjoint-B | 11,313 | 3/3 | 3/3 | PASS 3/3 | 0.208 / 0.209 | 22.282 / 21.709 |
| W3-disjoint-A | 16,000 | 3/3 | 3/3 | PASS 3/3 | 0.304 / 0.266 | 43.942 / 28.393 |
| W3-disjoint-B | 16,000 | 3/3 | 3/3 | PASS 3/3 | 0.311 / 0.266 | 34.243 / 24.347 |

| W4/A rate /s | SPR9 | Main | p50 R9/main ms | p99 R9/main ms |
|---:|---:|---:|---|---|
| 100 | 3/3 | 3/3 | 4.186 / 8.946 | 7.401 / 13.541 |
| 200 | 3/3 | 3/3 | 4.198 / 7.045 | 6.906 / 13.484 |
| 400 | 3/3 | 3/3 | 5.366 / 8.233 | 10.125 / 14.696 |
| 800 | 3/3 | 3/3 | 5.407 / 8.511 | 9.921 / 16.441 |

### PG CPU, WAL, prefix and loans

[Matched native CPU/WAL ledger](./COSTS.md) publishes every matched phase/cell/rate, including reads and low-rate points. [The intercohort WAL ledger](./maintenance-intervals.json) also reports activity between retained cohort edges, including setup, maintenance and statistics-publication lag; it does not label every gap byte as maintenance. Whole-cohort CPU and WAL divide by all ACKs; the historical measured-window CPU estimate uses its separate launch anchor and measured ACK divisor. Failed-cohort costs include refusals/voids and maintenance. The old +30% CPU and 6.0/6.4 ms authorizing stops are retired by §23; these observations explain, rather than override, the SLO verdicts.

[Separate diagnostic companions](./DIAGNOSTICS.md) supply prefix release, resolved−W lag, loan occupancy, dispatch and pool clocks at each candidate qualifying/first-failing write rung. They are not substituted for native measurements. An informational reference companion for an inconclusive cell cannot qualify that cell or replace either noisy native attempt. Width 29, cap 32, ordered prefix ACKs, through-W holds, two images, enriched attempts, freshness/deadlines, catch-up and retention remain enabled.

### One-CPU information

5 repetitions per point of information at the dedicated-grant W4/A and hot1/B deciding rates. Each system’s private PG family, background workers included, is pinned to logical CPU **0** with aggregate **cpu.max = 100000 100000** (1 CPU-s/s). App/proxy/generator placement and memory/storage/durability stay fixed. The rate set includes SPR9 and Supabase qualified/failing bounds. Hot1/B Convex uses its own qualified/failing bracket because it already fails far below those deciding rates; W4/A uses its direct comparison points and skips implausible higher rates.

| Cell | System | Rate /s | Passes | p99 ms by repetition | Throttled periods | Throttled ms | CPU some-pressure ms |
|---|---|---:|---:|---|---:|---:|---:|
| W4-disjoint-A | convex | 3200 | 0/5 | 1055.916, 1055.392, 1055.916, 1054.867, 1055.392 | 39 | 14.376 | 319585.942 |
| W4-disjoint-A | main | 3200 | 0/5 | 1014.497, 1015.022, 1016.070, 1015.022, 1015.022 | 0 | 0.000 | 20728.761 |
| W4-disjoint-A | main | 3805 | 0/5 | 1015.022, 1017.119, 1016.070, 1015.022, 1014.497 | 0 | 0.000 | 20879.105 |
| W4-disjoint-A | r9 | 3200 | 0/5 | 1014.497, 1013.973, 1015.546, 1013.973, 1013.973 | 0 | 0.000 | 85560.872 |
| W4-disjoint-A | r9 | 3805 | 0/5 | 1015.022, 1014.497, 1014.497, 1015.022, 1014.497 | 0 | 0.000 | 86020.838 |
| W4-disjoint-A | supabase | 3200 | 0/5 | 1020.789, 1021.313, 1020.789, 1020.264, 1020.789 | 0 | 0.000 | 101710.219 |
| W4-disjoint-A | supabase | 3805 | 0/5 | 1021.313, 1020.789, 1020.789, 1020.789, 1020.789 | 0 | 0.000 | 101558.218 |
| W5-hot1-B | convex | 565 | 3/5 | 32.031, 30.327, 1075.839, 31.212, 1083.179 | 54 | 20.994 | 513655.284 |
| W5-hot1-B | convex | 800 | 0/5 | 1053.819, 1054.343, 1053.295, 1054.343, 1053.819 | 120 | 48.544 | 749568.328 |
| W5-hot1-B | main | 2690 | 0/5 | 1017.643, 1018.167, 1017.643, 1017.643, 1018.167 | 0 | 0.000 | 26269.581 |
| W5-hot1-B | main | 3200 | 0/5 | 1018.692, 1017.643, 1017.119, 1019.216, 1017.643 | 0 | 0.000 | 25909.507 |
| W5-hot1-B | main | 4525 | 0/5 | 1018.167, 1018.692, 1017.643, 1017.643, 1017.119 | 0 | 0.000 | 26406.840 |
| W5-hot1-B | r9 | 2690 | 0/5 | 1016.070, 643.301, 1009.254, 1006.633, 1007.157 | 0 | 0.000 | 67653.040 |
| W5-hot1-B | r9 | 3200 | 0/5 | 1013.973, 1015.022, 1015.546, 1015.546, 1015.022 | 0 | 0.000 | 81174.215 |
| W5-hot1-B | r9 | 4525 | 0/5 | 1017.643, 1018.692, 1016.594, 1016.594, 1016.594 | 1 | 0.246 | 80915.156 |
| W5-hot1-B | supabase | 2690 | 0/5 | 1021.313, 1021.313, 1021.313, 1021.837, 1021.313 | 0 | 0.000 | 94698.547 |
| W5-hot1-B | supabase | 3200 | 0/5 | 1020.789, 1021.313, 1021.837, 1021.837, 1020.789 | 0 | 0.000 | 94700.461 |
| W5-hot1-B | supabase | 4525 | 0/5 | 1021.313, 1020.789, 1021.313, 1020.789, 1021.313 | 0 | 0.000 | 94510.331 |

CPU statistics/pressure span the outer per-trial observation, including the final quiet gate and drain; they are evidence of the imposed constraint, not an exactly matching 20 s CPU-cost window. Zero throttling is reported as zero: affinity already limits execution to one logical CPU, so pressure can show contention without quota throttling. These two-cell observations do not qualify the RFC’s six-write/six-read one-CPU gate, default-on or an “every scenario” claim. A dedicated-grant rate that fails here is a limit on transferring that capacity claim to one CPU.

### Verification and custody

Independent audit: **883 raw attempts**, **879 selected**, 43,767,280 measured arrivals; 5 contaminated attempts, 1 ineligible selected, 28 counter mismatches. Every failure is retained. Arrival arithmetic, original HDR histograms, durable counters, quiet tails/census, plan declaration times, binary identity, G6 and collector settings are recomputed. The unchanged S1 auditor runs separately; explicit terminal predicates absent from that older auditor are disclosed in its receipt.

[Method/build/fixture/claim scope](./METHOD.md), [verification](./verification.json), [original auditor](./original-harness-audit.json), [archive receipt](./archive.json), [process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [known-secret audit](./secret-audit.json). Raw trials, SQL, histograms, samples, fixture rows and binaries stay outside Git. No product change, push, origin fetch, stash or git-config mutation.

Counter-mismatch repetitions by system: **convex 10, supabase 18**. These observations remain failed and cannot qualify a rate; exact deltas and acknowledgement counts are retained in verification.json. Systems absent from this list have no observed counter mismatch.
