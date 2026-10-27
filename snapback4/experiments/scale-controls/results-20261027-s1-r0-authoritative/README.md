# S1-R0 — authoritative restored R0 vs Supabase, expo-build-450b

**(a) W4/A 3,805/s: R0 passes 5/5 (5/5; first three 3/3).** Ordered native sent-service mean upper bounds: **5.8931, 6.0872, 6.1165, 6.1078, 5.8397 ms**.

**(b) W4/A 4,525/s: R0 0/5; first three 0/3.** Ordered native sent means: **7.0712, 7.1316, 7.0267, 7.0112, 7.0289 ms**. Every mean ≤6.0 ms: **NO**. The restored-R0 authorizing gate is **NOT met; this result does not authorize R1–R5**.

Conservative lower bounds on those five 4,525/s sent means are **7.0193, 7.1157, 7.0223, 7.0069, 7.0245 ms**. These use each frozen three-significant-digit HDR bucket's low value and assign unsent timing samples to the largest possible buckets before taking the sent mean. Every lower bound also exceeds 6.0 ms.

**(c) Highest passing tested write rungs.** Both systems are rerun here, per repetition R0→Supabase, with a fresh service for every measurement. A qualifying rung requires every selected repetition; first-three results use the first three in execution order, never a favorable subset. All requested rungs run despite earlier failures. “No tested pass” refers only to this campaign’s ≥2,690/s rates and does not erase the lower passing S1-TB controls.

| Cell | R0 highest 5/5 /s | Supabase highest 5/5 /s | R0 / Supabase highest first 3/3 /s | Verdict on tested rungs |
|---|---:|---:|---:|---|
| W4/A | 3,805 | 3,200 | 3,805 / 3,200 | R0 higher qualifying tested rung |
| W4/B | 3,200 | no tested pass | 3,200 / no tested pass | R0 higher qualifying tested rung |
| W5 hot1/B | 2,690 | 2,690 | 2,690 / 2,690 | tie at highest qualifying tested rung |

**Control refresh:** Supabase now passes W4/A 3,200/s 5/5, versus 0/5 in [S1-TB](../results-20261027-s1-tiebreak-controls/README.md); both observations remain recorded. Its W4/B 2,262/s 5/5 result in S1-TB is historical and was not rerun here. The current W4/B control has no 5/5 pass at the requested rates ≥2,690/s; that is not a zero-capacity claim.

**W4/B caveat:** R0’s first 2,690/s repetition failed with an ownership pause and 100% measured HTTP 409 errors. It remains a clean failure in the table; later passing rungs do not establish monotonic reliability. The [failure and quiescent audit](./ownership-failure.json) and full interruption are described below.

The per-rate table gives medians of clean selected repetition percentiles, including clean failures. Errors sum measured windows; [rate aggregates](./rates.json) retain ranges, maximum error fractions, error classes and ordered pass flags. A median p99 below the SLO cannot rescue a 4/5 rung.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p50 / p99 ms | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---:|---:|
| r0 | W4/A | 2,690 | 5/5 | 3/3 | 5.78 / 9.01 | 0.02 / 0.20 | 0 | 0 |
| supabase | W4/A | 2,690 | 5/5 | 3/3 | 7.63 / 11.36 | 0.02 / 0.22 | 0 | 0 |
| r0 | W4/A | 3,200 | 5/5 | 3/3 | 5.85 / 34.57 | 0.01 / 24.58 | 0 | 0 |
| supabase | W4/A | 3,200 | 5/5 | 3/3 | 7.94 / 67.08 | 0.02 / 57.05 | 0 | 0 |
| r0 | W4/A | 3,805 | 5/5 | 3/3 | 5.99 / 22.77 | 0.01 / 14.36 | 0 | 0 |
| supabase | W4/A | 3,805 | 0/5 | 0/3 | 313.26 / 497.29 | 304.61 / 488.64 | 6 | 0 |
| r0 | W4/A | 4,525 | 0/5 | 0/3 | 565.18 / 686.29 | 557.84 / 678.95 | 274 | 0 |
| supabase | W4/A | 4,525 | 0/5 | 0/3 | 1004.54 / 1010.30 | 997.20 / 1003.49 | 76,076 | 0 |
| r0 | W4/B | 2,690 | 4/5 | 2/3 | 6.31 / 10.84 | 0.02 / 0.21 | 53,800 | 0 |
| supabase | W4/B | 2,690 | 4/5 | 2/3 | 9.92 / 56.23 | 0.02 / 44.40 | 0 | 0 |
| r0 | W4/B | 3,200 | 5/5 | 3/3 | 6.40 / 11.58 | 0.01 / 1.77 | 0 | 0 |
| supabase | W4/B | 3,200 | 0/5 | 0/3 | 1002.44 / 1011.35 | 992.48 / 1001.39 | 11,326 | 0 |
| r0 | W4/B | 3,805 | 4/5 | 2/3 | 6.55 / 70.19 | 0.01 / 61.80 | 0 | 0 |
| supabase | W4/B | 3,805 | 0/5 | 0/3 | 1005.58 / 1011.88 | 997.20 / 1003.49 | 76,563 | 0 |
| r0 | W5 hot1/B | 2,690 | 5/5 | 3/3 | 6.28 / 9.11 | 0.02 / 0.10 | 0 | 0 |
| supabase | W5 hot1/B | 2,690 | 5/5 | 3/3 | 9.83 / 51.77 | 0.02 / 39.88 | 0 | 0 |
| r0 | W5 hot1/B | 3,200 | 4/5 | 2/3 | 6.50 / 62.75 | 0.01 / 52.76 | 0 | 0 |
| supabase | W5 hot1/B | 3,200 | 0/5 | 0/3 | 1003.49 / 1011.35 | 993.53 / 1001.39 | 13,496 | 0 |
| r0 | W5 hot1/B | 3,805 | 0/5 | 0/3 | 953.16 / 1006.11 | 944.77 / 997.72 | 2,207 | 0 |
| supabase | W5 hot1/B | 3,805 | 0/5 | 0/3 | 1005.58 / 1011.35 | 997.20 / 1002.96 | 77,105 | 0 |

**R0-only write sanity (three repetitions).** The historical advocate comparison rates supplied by the brief are 800/s for hot1/A and 25/70/s for exact A/B; these are context, not newly rerun controls or five-run qualifications.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p50 / p99 ms | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---:|---:|
| r0 | W5 hot1/A | 2,262 | 3/3 | 3/3 | 5.84 / 9.90 | 0.02 / 0.07 | 0 | 0 |
| r0 | W5 hot1/A | 3,200 | 3/3 | 3/3 | 5.88 / 40.86 | 0.01 / 30.85 | 0 | 0 |
| r0 | W5 exact/A | 1,131 | 3/3 | 3/3 | 10.28 / 18.58 | 0.02 / 0.07 | 0 | 0 |
| r0 | W5 exact/B | 1,131 | 3/3 | 3/3 | 12.66 / 21.87 | 0.02 / 0.06 | 0 | 0 |

**(d) Read non-regression: established at the six tested reference rungs (18/18 clean initial passes).** Reference rates come from the latest landed standalone native-Postgres [S1-RD report](../results-20261025-s1-reads/README.md), report commit `be0b9219f0`, product `22412ba20b`: W1 A/B 8,000/s, W2 A/B 11,313/s, W3 A/B 16,000/s (G6). These are scoped pure-read observations, not mixed-reader progress or SDK qualification.

| System | Cell | Offered /s | Passes | First 3 | p50 / p99 ms | Dispatch p50 / p99 ms | Errors | Contaminated attempts |
|---|---|---:|:---:|:---:|---:|---:|---:|---:|
| r0 | W1/A | 8,000 | 3/3 | 3/3 | 1.62 / 6.07 | 0.01 / 0.10 | 3 | 0 |
| r0 | W1/B | 8,000 | 3/3 | 3/3 | 2.28 / 10.05 | 0.01 / 0.09 | 11 | 0 |
| r0 | W2/A | 11,313 | 3/3 | 3/3 | 0.21 / 19.60 | 0.01 / 8.30 | 0 | 0 |
| r0 | W2/B | 11,313 | 3/3 | 3/3 | 0.21 / 21.35 | 0.02 / 10.08 | 0 | 0 |
| r0 | W3/A | 16,000 | 3/3 | 3/3 | 0.29 / 26.15 | 0.03 / 18.22 | 0 | 0 |
| r0 | W3/B | 16,000 | 3/3 | 3/3 | 0.26 / 28.62 | 0.03 / 20.68 | 0 | 0 |

**R0 diagnostics.** Every W4/A native repetition has an indexed, fresh-service companion at the same rung with the report’s existing numeric profile/stats/series diagnostics. [Twenty native/companion rows](./DIAGNOSTICS.md) and [numeric aggregates](./w4-a-diagnostics.json) report sent mean, resolved-revision-minus-W, commit-confirm-to-ACK-release wait, available width, time-weighted mean/p99/peak loans, custody, pool waits, PG/app CPU ms/ACK, WAL B/ACK and syncs/ACK. Native means/CPU/WAL belong to the native trials; prefix/loan clocks belong to the explicitly separate diagnostic companions. Profiling is off for every native capacity/sanity/read trial. Instrumented latency never substitutes for native qualification.

**Protocol, build and custody.** The governing authorizing boundary is [RFC 003 §8.2](../../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md). NEW worktree `/home/ccheever/projects/sb4-r0b` comes from the already-local `sb4-pg/r0-450b`, exact commit `ad1bfc1839340bde4bb9de006a3a94cfe181ba38`. Its source report is `ad1bfc1839:snapback4/reports/20261026-spike-r/REPORT.md`, Round 4; no origin fetch. The release/Postgres build uses its own in-worktree target, `--release --locked -j 6 -p snapback4 --features postgres`, `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_RELEASE_DEBUG=line-tables-only`, and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`; only the cache-availability `--offline` switch is added. [Build receipt](./r0-build.json). R0 binary SHA-256 **`a21127fd25d127558de0778a98d6a99432a96680dc2202524ff6f5f7ad929ebf`**.

Native R0 selects `SNAPBACK4_SPIKE_R=1`, `FENCE=session`, `HEAD=async`, `DISPATCH=direct`, `WIRE=explicit`; other pool/base defaults remain selected. The restored write protocol keeps ordered ACKs and through-W footprints, immutable writer bases, counted two-image updates, enriched attempts/void arbitration, deadlines/freshness checks, catch-up and retention. The conservative reader gate remains. The actual allocation is **29 shared data loans + owner/lease/optional second ordered writer ≤32 total product connections**; no role-fold credit or enlarged pool. Sampled product-session peaks and corrected loan meters are retained. This report makes no crash/takeover, keyed SDK, mixed-read-floor, fault-soak, production/default-on or publication claim. The 450a results are context and never authorizing evidence.

**Common S1 method.** Unchanged `s1-onehost.py` from `sb4-s1sk`, frozen S1-C generator reused from WB/WC/TB; the current-tree generator’s newer instrumentation is not used. Its artifact SHA differs from original S1-C but its frozen sources match, as disclosed by the [generator witness](./generator-source-witness.json). [Native-main/generator/seed custody](./binary-custody.json). Same one-host expo-build-450b (`expose-builder-pixel-a`, Ryzen 5 3600), independent private socket-only PG16.15 fixtures with 1M messages. PostgreSQL uses logical CPUs 0–2,6–8; app/common Unix delay proxy 3–4,9–10; generator 5,11. A adds 250 µs/direction and B 500 µs/direction. Each measurement gets a fresh service, 10 s warmup +20 s measured, 32 write clients or 128 read clients, concurrency/pool cap 32. The existing fixture helper seeds managed rows through Engine::seed_at; every deterministic image and maintained-total check passes. [Seed, affinity, stack and before/after RTT witnesses](./method-witnesses.json).

The unchanged [S1 pass rule](../results-20261024-s1-onehost-controls/METHOD.md) is intended-arrival p99 ≤100 ms writes /50 ms reads, measured error fraction ≤0.1%, and exact durable-counter equality against **all** write ACKs including warmup, in every repetition. Dispatch lag remains included in intended-arrival latency. Clean failures are retained. Supabase retains the inherited SQL drain; equality remains mandatory even though that drain is not a proof of HTTP quiescence. G6 `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250` retains the declared single-owner `ha=none` [clock assumptions](../../../reports/20261024-g6/REPORT.md); synchronous arm S/default depth 2 is unchanged.

Supabase is the unchanged PostgREST 14.18 advocate with vendor RLS/auth SQL, definer RPCs, prepared statements, JWT cache 1,000 and pool 32 plus schema listener. Effective redacted configuration matches S1-C byte for byte before timed load. Live PG settings match except private port; fsync, synchronous_commit and full_page_writes remain on, shared_buffers 8 GiB, WAL min/max 1/4 GiB, JIT off. The same TB outside-Git endpoint transplant changes only the adapter’s hardcoded port to **55441** and binds its original globals to the configured core/adapter settings. No connection to the protected PG17/55440 cluster and no q24 access. [S1-C input witness](./s1c-input-witness.json), [endpoint adaptation](./endpoint-adaptation.json).

The author’s adopted S1 ruling 9 supplies the quarter rungs 3,805, 1,903 and, by the same construction, 2,690 and five deciding repetitions. These were predeclared by the brief; no outcome-dependent rung or repetition selection occurs. The exact ordered campaign is retained as [sequence metadata](./sequence.json). A separate fresh native-main fixture is created only if a read comparison is required, avoiding cross-version rewriting of the R0 schema.

**Quiet-host qualification.** Ten consecutive seconds before each cohort require no unrelated process above 0.3 core and 1-minute load <1.5. A 1 s /proc PID/start census spans every full trial, including warmup and drain; aggregate unrelated CPU >1 core for >2 s cumulative marks CONTAMINATED, retains/excludes that attempt, then permits one fresh-service retry after another quiet gate. Clean failures are never retried. Idle peer fixtures and all supervisor descendants are identified as lane owned. Finite sampling can miss short-lived processes, and CPU tick granularity affects a final partial interval. These observations qualify a shared-host benchmark, not an exclusive-host reservation.

**150 raw trials / 150 selected; 0 contaminated attempts; 0 selected still contaminated.** 304 released quiet gates, minimum 10.151 s; maximum census interval 1.194 s. Independent auditing recomputes 12,845,000 measured arrivals, every SLO/error decision, histogram identity, durable arithmetic and contamination classification: **0 counter mismatches**. [Qualification](./qualification.json), [verification](./verification.json).

Minimum observed `/home` free: **26.70 GiB**, above the continuous 25 GiB stop floor. The new R0 build’s inactive intermediates were reclaimed after preserving its binary ([receipt](./owned-cache-cleanup.json)). Later, completed first-generation raw records were losslessly compressed between measurements ([receipt](./raw-compression-maintenance.json)); the original S1-C target’s inactive Cargo intermediates were reclaimed under profile locks after checking for live references/compilers and verifying all retained artifacts ([receipt](./original-s1c-cache-cleanup.json)). Short windows, finite rungs, shared-host scheduling, native settlement/cache differences and separate instrumentation windows limit interpretation. No product/checked-in runner changes, fetch, push, stash, Git configuration change, paid resources or publication.


**Retained product failure and continuation.** The first R0 W4/B 2,690/s load returned HTTP 409 for all 53,800 measured arrivals after six warmup successes; its native post-load drain returned `E_STORE_OWNERSHIP`. It is retained as the first clean **FAIL**, never replaced. Both private workers/clusters stopped. A separate read-only restart of the owned PG fixture found exactly six durable counter increments for six ACKs, `head = max(seq) = count = 2,131,536`, and no gaps. No managed-row repair or protocol change occurred. The native fixture was verified and reused with a fresh owner; Supabase was freshly seeded because its normal cleanup had removed its cluster. Ordinal R0→Supabase interleaving continued at the missing control measurement, after the documented interruption. The first failure’s basic polling-resource file was lost when the unmodified runner raised during drain; the supplemental CPU and full 1 s contamination census survive, its launch anchor is reconstructed from the recorded PID ledger, and its durable after-receipt is the quiescent read-only audit. Its missing post-cell RTT is explicit. A continuation wrapper file-write precondition failed before PG/timing and was corrected outside Git; no timed result was discarded. Raw original controllers, errors, restart state and receipts are archived. Later higher-rung passes cannot erase this lower-rung ownership failure.

**Diagnostic coverage limitation.** W4/A 2,690/s companion 5 is retained as a clean failure with 53,800 measured errors and only 0.0/20,000 ms of measured-window series coverage. The 2,690/s fifth companion paused with HTTP 409 after five warmup ACKs, with exact durable equality; it is separate from the successful fifth native run. Missing measured prefix/loan occupancy is N/A, never extrapolated or replaced. Available phase-clock deltas include its small warmup activity. [Failure receipts](./ownership-failure.json), [coverage and counts](./w4-a-diagnostics.json).

The completed Supabase role was normally closed between measurements, after the first R0-only sanity trial finished; its private PG data was removed. No app or generator was paused. [Retirement receipt](./closed-role-supabase-maintenance.json).

Raw trial/HDR/process/CPU/series evidence stays outside Git: `/home/ccheever/sb4scale/archive/s1-r0-authoritative-20261027.tar.gz`. SHA-256 **`9879fc4e3d69ed179b0a65f4d01ba586e3c3226db7db79f162671341fdacd61c`**.

**PIDs left: none.** Recorded PID/start identities and private-path checks include build, services, proxies, generators, PG, controllers and postprocessing; stopped cluster sockets/pidfiles and private credential cleanup are independently checked. Known-secret scans cover raw evidence, summaries and exact staged report blobs. [Process audit](./process-audit.json), [private cleanup](./private-cleanup.json), [secret scan](./secret-audit.json), [staged scan](./staged-secret-audit.json), [repository checks](./repository-checks.json).
