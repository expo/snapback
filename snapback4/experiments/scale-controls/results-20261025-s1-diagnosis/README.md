# S1-WD — diagnosis of the four lost one-host cells

The write gap is reproducible; the two anomalous G6 read losses recover in the new native runs. The S1 writes **do use G3b's buffered parallel overlay path**. Their effective batches are much smaller than the closed-loop engine harness, and every batch still pays five G5 or six G6 serial PG flights plus a roughly 2.6 ms durable WAL sync. An overloaded service then fills the fixed client population: intended arrivals wait in the generator, producing the approximately one-second dispatch cliff.

There is also a distinct cold-reader convoy. Opening readers under global locks can delay requests until the unchanged client's one-second deadline expires. The traced cold write probe commits eight operations whose responses arrive around that deadline; those eight exactly explain its durable-counter excess over acknowledgements. Native burst controls and their limits appear below. **No product code is changed by this lane.**

## Native repetitions and cell attribution

Product source is the requested `0ce0c0d07864efb9f0b7315388f0751dc8282e11`, on local branch `sb4-pg/s1-wd`. This includes inherited FF2 commit `adbb3cd178`; the historical comparison used `c985dbc640`. The authoritative load generator is the exact archived S1-C release executable, with the original scheduling, normalization, deadlines and qualification. Each native cohort retains **10 s warm-up, 20 s measurement and three repetitions**, including every failure. G6 means `SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=1000,250`; G5 means the variable is absent. The existing native 250 ms numeric cache observer is enabled; it reserves 128 KiB inside the unchanged 448 MiB budget. No per-request trace is enabled for these rate results.

| Cell | Config | Highest complete pass /s | p50 / p99 ms | Passing repetitions at each offered rate |
|---|---|---|---|---|
| W4-A | G6 | 1,131 | 19.69 / 27.80 | 800: 2/3, 1,131: 3/3, 1,600: 0/3, 3,200: 0/3 |
| W4-A | G5 | 800 | 16.86 / 24.61 | 800: 3/3, 1,131: 2/3, 1,600: 0/3, 3,200: 0/3 |
| W4-B | G6 | **none** | — | 800: 2/3, 1,131: 0/3, 1,600: 0/3, 3,200: 0/3 |
| W4-B | G5 | **none** | — | 800: 2/3, 1,131: 0/3, 1,600: 0/3, 3,200: 0/3 |
| W5 MIX-B | G6 | **none** | — | 800: 2/3, 1,131: 0/3, 1,600: 0/3, 3,200: 0/3 |
| W5 MIX-B | G5 | **none** | — | 800: 2/3, 1,131: 0/3, 1,600: 0/3, 3,200: 0/3 |
| W1-B | G6 | 8,000 | 2.12 / 23.20 | 4,000: 3/3, 5,656: 3/3, 8,000: 3/3, 11,313: 0/3 |
| W1-B | G5 | 8,000 | 2.11 / 31.03 | 4,000: 3/3, 5,656: 3/3, 8,000: 3/3, 11,313: 0/3 |
| W2-A | G6 | 11,313 | 0.21 / 21.86 | 100: 3/3, 5,656: 3/3, 8,000: 3/3, 11,313: 3/3 |
| W2-A | G5 | 5,656 | 1.37 / 2.74 | 100: 3/3, 5,656: 3/3, 8,000: 0/3, 11,313: 0/3 |

“Highest” means highest complete passing cohort **among the commissioned rungs**, not a searched capacity ceiling. Write rungs are 800/1,131/1,600/3,200; W1 B is 4,000/5,656/8,000/11,313; W2 A is 100/5,656/8,000/11,313. A cell with no complete passing cohort is reported that way: two later passing repetitions do not repair a first-repetition counter mismatch. [Every native rung and repetition spread](./LATENCY.md), [bounded cohort aggregates](./cohorts.json), [counter arithmetic](./counter-arithmetic-audit.json).

| Historical loss/anomaly | Attribution from this lane | What the evidence rules out or leaves open |
|---|---|---|
| W4 A: best control 3,200 → G6 800 | Native G6 now qualifies 1,131. At that rate the traced batch has mean N=15.67 and a 13.73 ms cycle; target remains 32. Five/six flights, durable flush and partial fill set the service rate. | G3b ineligibility, conflict reruns and adaptive target contraction do not explain this cell. G6's extra publication query is only part of the gap. |
| W4 B: 1,600 → 800 | At 1,131, traced G6 mean N=15.98, cycle 16.19 ms: about 987 members/s before SLO headroom. G5 remains overloaded at this rung. | The extra link RTT is multiplied across serial flights; default G5 alone is insufficient. First 800/s native cohorts have a separate whole-cohort counter failure. |
| W5 nominal 1% mix B: 1,600 → 800 | Mean N=16.00, 15.71 ms G6 cycle at 1,131. Approximately 0.16 membership/dependent-level flights per batch are added by the nominal 1% mix. | This is the nominal mix, not the all-shared W5 loopback workload. No observed conflict rerun explains the sustained ceiling. |
| W2 A: 8,000 → 5,656 | Native G6 qualifies 8,000 and 11,313. At 8,000 p99 is 4.76–6.95 ms; at 11,313 it is 20.28–22.33 ms. Native W2 hits are about 92%; pure-read gate-closed time and waits are zero inside the measured counter windows. | The prior loss is not a stable 5,656/s ceiling on the requested tree. Version and shared-host effects must be distinguished by the archived-release replay below. |
| W1 B: G6 2,828 vs G5 8,000 | Native G6 qualifies 8,000; p99 is 12.60–28.82 ms. W1 has zero hits. At 11,313 the native G6 run overloads and dispatch lag dominates. | There is no G6 hit-validation cost to charge to W1. A configuration-only causal slowdown is not established by the historical serial runs. |
| First 100/s smoke: p99 ≈1,002 ms | The historical first window has 88 request timeouts concentrated around seconds 11–13; dispatch p99 is only about 3.1 ms. Whole-host CPU rises to 11–12 logical CPUs during the burst. New native 100/s repetitions pass. | This original burst is HTTP-side delay, unlike the sustained dispatch-backlog failure. Its exact historical instruction/PID cannot be recovered retrospectively; cold-reader and host-contention evidence is distinguished below. |

The controls are inherited observations from the [final comparison](../results-20261024-s1-onehost-final/README.md); they are not rerun here. This lane diagnoses the losses and does not replace that comparison's full matrix.

## Writes: measured batches, phases and cost

The lightweight out-of-tree probe uses the same Quarry programs, fixture, client counts and delayed links, with 2 s warm-up/8 s measurement/one repetition per diagnostic rung. These traces attribute work; native repetitions above determine SLO qualification. All per-batch N, collection clocks, eligibility, reruns, queue ages, phase clocks and flight events remain in the raw archive. [All 24 write probe aggregates](./write-attribution.json).

| Cell/config | Mean N | Cycle ms | Facts ms/F | Levels ms/F | Parallel ms | Apply+tail ms/F | Publication ms/F | COMMIT ms/F | Total F |
|---|---|---|---|---|---|---|---|---|---|
| g6-w4-a | 15.67 | 13.733 | 1.794 / 1.00 | 0.000 / 0.00 | 0.617 | 2.657 / 1.00 | 0.753 / 1.00 | 3.445 / 1.00 | 6.00 |
| g5-w4-a | 13.25 | 11.446 | 1.716 / 1.00 | 0.000 / 0.00 | 0.609 | 2.834 / 1.00 | 0.000 / 0.00 | 3.177 / 1.00 | 5.00 |
| g6-w4-b | 15.98 | 16.192 | 2.234 / 1.00 | 0.000 / 0.00 | 0.726 | 2.775 / 1.00 | 1.239 / 1.00 | 3.849 / 1.00 | 6.00 |
| g5-w4-b | 16.00 | 15.152 | 2.258 / 1.00 | 0.000 / 0.00 | 0.676 | 2.904 / 1.00 | 0.000 / 0.00 | 3.776 / 1.00 | 5.00 |
| g6-w5mix-b | 16.00 | 15.709 | 2.185 / 1.00 | 0.204 / 0.16 | 0.590 | 2.708 / 1.00 | 1.221 / 1.00 | 3.668 / 1.00 | 6.16 |
| g5-w5mix-b | 16.00 | 15.633 | 2.308 / 1.00 | 0.211 / 0.16 | 0.753 | 2.840 / 1.00 | 0.000 / 0.00 | 3.846 / 1.00 | 5.16 |

Times are **mean wall ms/batch** at offered 1,131/s; flight counts are mean per batch. Apply is deferred into the durable tail, so its separate span is about 0.002 ms, with no separate flight. W4 has no dependent-level flight. Fence/BEGIN costs two flights; it is separate from facts, tail and COMMIT. Phase medians/means are not interchangeable or generally additive; the aggregate records preserve counts and distributions. COMMIT includes transport, driver and durability. Overlapping HTTP ingress on other threads is excluded from these writer flight counts.

All **13,285/13,285** measured write batches are eligible; **13,284/13,285** use the buffered wave. The exception is one N=1 batch, for which `program_group` deliberately skips wave preparation. There are **zero conflict reruns, retry attempts or failed batch attempts** in these measured probe windows. Every adaptive target stays at 32. Gates close around COMMIT for approximately 23–24% of G6 write time, rather than for one-second intervals.

| Cell/config | Collection p50 µs | Accept→batch queue p99 ms | Gate closed mean ms / fraction | Native server CPU | Native PG CPU | Native proxy CPU | Native generator CPU |
|---|---|---|---|---|---|---|---|
| g6-w4-a | 3.43 | 22.37 | 3.45 / 24.4% | 0.52 | 1.11 | 0.43 | 0.24 |
| g5-w4-a | 2.95 | 15.45 | 0 / 0% | 0.53 | 1.12 | 0.42 | 0.25 |
| g6-w4-b | 2.94 | 21.36 | 3.86 / 23.1% | 0.47 | 1.19 | 0.34 | 0.21 |
| g5-w4-b | 3.29 | 19.25 | 0 / 0% | 0.48 | 1.27 | 0.33 | 0.21 |
| g6-w5mix-b | 2.58 | 22.34 | 3.68 / 22.7% | 0.47 | 1.16 | 0.34 | 0.21 |
| g5-w5mix-b | 3.66 | 19.51 | 0 / 0% | 0.50 | 1.26 | 0.34 | 0.22 |

CPU entries are sampled logical CPUs, medians of the three native repetitions at 1,131/s, covering warm-up+measurement+drain; PG includes private-cluster background/observer work. Queue, collection and gate clocks are from the separate lightweight probe. A 100 ms process census cannot assign overlapping PG CPU to individual 10–20 ms batches. No CPU-derived product ceiling is asserted.

There is **one additional warm independent authority/ingress statement per HTTP mutation**, outside the serial batch. [`ingress_of`](../../../crates/snapback4/src/serve_identity.rs) always resolves supervised ingress; queries can reuse a nonauthorizing carried planning hint. The writer then resolves fresh authority again inside its fenced cut. That extra parallel ingress consumes PG/reader work and an ingress RTT, but **N × RTT must not be added to the serial cycle**. The PG role census identifies reader backends plus the writer as the CPU consumers; it does not attribute all PG CPU to autovacuum.

The [G3b-par loopback result](../../../reports/20261024-g3b-parallel-overlay/REPORT.md) has median 3,422.8 W4 writes/s, mean N≈31.90, hence an effective cycle around **9.32 ms**. It uses 32 closed-loop engine producers and excludes HTTP, delayed links and the million-message fixture. In S1, the cap is still 32, but `command_batch::run` drains only already-enqueued work and immediately stops on an empty mailbox. The apparent 1 ms “window” is a draining cap, **not a fill wait**. Collection takes microseconds; two complementary groups of roughly 16 HTTP clients keep the writer busy. The native PG statement/counter witness independently confirms partial fill without request instrumentation. [Native batching witness](./native-batching.json), [collection/adaptive implementation](../../../crates/snapback4-core/src/engine/command_batch.rs).

The observed fill/cycle identity makes the gap concrete: on B, `3,422.8 × (15.98 / 31.90) × (9.32 / 16.19) ≈ 987 writes/s`; the corresponding A calculation is about 1,141/s. These reconcile the two measured shapes before open-loop SLO headroom; they do not forecast a changed system.

At 1,131, native WAL sync averages approximately **2.55–2.70 ms** across the inspected configurations, with no checkpoint beginning in those inspected repetition-0 windows. PG's write syscall time is only about 0.02 ms; WAL sync is distinct. The private-cluster counters include lease/background transactions, sampled once per second inside the trial snapshots. They corroborate the durable flush contribution to the measured COMMIT span without treating all COMMIT time as fsync. [WAL aggregates](./wal.json).

The 3,000→800 difference therefore combines **roughly half-filled batches**, added serial delayed-link flights, the measured durable flush, HTTP ingress/response work and the fixture's execution/tail cost. It is not a fourfold regression in parallel overlay interpretation. The supplied evidence does not isolate every remaining fixed millisecond between hosts/campaigns; no sum of independently measured slopes is presented as a qualified throughput result.

## Read stalls, renewals and cache pressure

The out-of-tree request trace records accept, dispatch/admission, reader checkout, cache candidate/hit/miss, gate wait, query completion, encode and response. Numeric events also record writer queue ages, batch publication revisions/head, grant renewals, gate open/close, revocation, cache retirement/eviction and maintenance/GC durations. The final four short probes additionally record **asynchronous reader permit/custody wait, actual query await and cold prepare**. The initial simple-query hook did not cover this async path; zero events from that hook are never claimed as zero read flights. No arguments, bearer values or returned rows enter the traces. [Read attribution](./read-trace-attribution.json), [native cache counters](./native-cache.json).

| Async trace at 8,000/s | Data queries / cache lookup | Query-await p50/p99 ms | Permit/custody p99 ms | Measured cold prepares | Worker admission p99 ms | Max HTTP worker queue |
|---|---|---|---|---|---|---|
| g5-w1-b | 1.000 | 2.54 / 4.26 | 0.0008 | 0 | 12.35 | 115 |
| g5-w2-a | 1.000 | 3.02 / 6.38 | 0.0008 | 0 | 14.90 | 119 |
| g6-w1-b | 1.000 | 2.54 / 4.25 | 0.0008 | 0 | 12.33 | 119 |
| g6-w2-a | 0.282 | 2.76 / 6.41 | 0.0010 | 0 | 13.90 | 116 |

Counts use the same monotonic time interval; edge requests and overloaded warm-up/drain overlap the boundaries. W1 and G5 W2 use approximately one data statement per lookup. G6 W2 hits skip that statement; its traced hit fraction is observer-sensitive. In the original lightweight G6 read intervals, no gate close or revocation occurs; renewal maximum is 25.4 ms, gate-read maximum is 1.06 ms, and engine command-queue depth is zero. HTTP worker queues reach 72–123 in the inspected high-rate intervals. No timely/expiry-sweep span occurs in those short intervals; cache evictions are observed, with native counts recorded separately. None of this establishes a one-second grant/GC pause.

| Native cell/config | Offered /s | Server CPU | PG CPU | Proxy CPU | Generator CPU |
|---|---|---|---|---|---|
| g5-w1-b | 8,000 | 2.02 | 2.23 | 1.30 | 1.28 |
| g5-w1-b | 11,313 | 2.45 | 2.77 | 1.31 | 1.39 |
| g5-w2-a | 8,000 | 1.92 | 5.41 | 1.31 | 1.33 |
| g5-w2-a | 11,313 | 1.90 | 5.40 | 1.30 | 1.50 |
| g6-w1-b | 8,000 | 2.01 | 2.24 | 1.30 | 1.27 |
| g6-w1-b | 11,313 | 2.46 | 2.78 | 1.32 | 1.40 |
| g6-w2-a | 8,000 | 1.39 | 0.81 | 0.27 | 1.43 |
| g6-w2-a | 11,313 | 1.80 | 1.01 | 0.30 | 1.77 |

These are native whole-trial sampled logical CPUs, including drain and private-cluster background work. At failing W1 B 11,313/s, **server+proxy consume about 3.78 of their four pinned logical CPUs**, while the generator uses about 1.40 of two; this supports app/proxy CPU pressure as the present W1 limit. At G5 W2 A 8,000/s, PG consumes **5.41 of six pinned logical CPUs**, whereas G6's zero-flight hits reduce this to 0.81. SMT logical CPUs are not independent physical cores; these samples identify resource pressure, not an exact CPU-derived capacity. This is why the proxy-inclusive result differs from the original outer sampler.

W2's workload spans 8,192 principal×room keys; the native 448 MiB cache retains roughly 7,800 entries with eviction pressure. At 8,000–11,313/s, roughly **8%** of native lookups miss. W3's principal-only working set is much smaller, so its prior 16,000/s result does not imply identical W2 cache/payload cost. W1's key stream has no useful repeat during these windows and never benefits from G6 hits. At 100/s, only 3,000 cohort requests occur, before the first natural W2 repeat; that smoke alone does not exercise repeated-key hits.

The original full request trace used `serde_json::to_writer(File)` under a global trace mutex, issuing many small writes. It caused substantial observer overhead. The **entire first 40-trial pass is retained and excluded from causal rate claims**. The second probe changes only the out-of-tree sink to serialize once and write once. Even this lightweight cache-path tracing changes lock timing and the miss ratio (about 30% in a traced W2 arm versus about 8% native). Native cache counters and native SLO cohorts are authoritative; trace rates and miss fractions are not substituted for them.

### Cold reader convoy and the one-second events

In the traced G6 W4 A first warm-up at 800/s, eight client `request_error` operations take **1,000.2–1,001.8 ms**. Matching server responses occur roughly **992–1,008 ms** after intake. Intake is below 0.11 ms and worker admission below 0.8 ms for these requests; individual reader mutex waits are **134–344 ms**. The durable counter exceeds the whole-cohort acknowledged count by **exactly eight**. This proves a response-deadline/counter failure mechanism in this diagnostic arm; it does not retroactively provide a trace of the old smoke.

[`Shared::reader` / `QueryReaders::detached`](../../../crates/snapback4/src/serve_readers.rs) opens a missing reader while holding the global reader mutex. [`Handle::reader`](../../../crates/snapback4-core/src/engine/postgres/handle.rs) performs before/after metadata transactions around a new connection. [`Pool::slot`](../../../crates/snapback4-core/src/engine/postgres/pipeline.rs) additionally holds its slots mutex across connect/startup qualification. An initially narrow pool can therefore grow serially when concurrency increases, also delaying reader returns. This is paid on demand; ten seconds of sequential low-rate warm-up does not necessarily fill a 30-reader pool.

Unchanged native release; 32 sequential credential primers, ten seconds of sequential 100/s unique W1 requests, then three synchronized 32-client unique-key bursts. A 5 s diagnostic timeout preserves responses beyond the ordinary 1 s deadline. Every one of the 384 burst responses validates. The same immutable 1M-message image is restored from the pre-campaign physical backup for these controls; counter/history state is the saved initial state, not the later write-grown state.

| Config | Link | Connections: primed → after low load → burst | First burst p99 ms | Warm bursts p99 ms | Valid burst responses |
|---|---|---|---|---|---|
| G5 | A | 4 → 4 → 32 | 961.18 | 11.29 / 9.92 | 96 |
| G5 | B | 4 → 4 → 32 | 1469.59 | 10.51 / 9.92 | 96 |
| G6 | A | 4 → 4 → 32 | 980.68 | 9.97 / 10.25 | 96 |
| G6 | B | 4 → 4 → 32 | 1531.87 | 10.36 / 9.67 | 96 |

The added return-lock trace separately observes **896–1,442 ms** reader-return spans during startup/warm-up and **31–53 ms** median reader-construction spans. Later warm return-lock p99 is small. The return waits explain why even requests whose query has completed can wait for the rest of the pool to be constructed. [Native controls](./cold-pool.json), [return/construction clocks](./reader-lock-summary.json), [eight traced deadline/counter mismatches](./cold-trace-summary.json).

The exact historical 100/s trigger remains an inference. Its CPU burst is observed; the cold-reader mechanism is directly traced in the new write arm and tested natively by the burst controls. No claim identifies a particular unrecorded competing historical process. Longer-running sustained overload has a different signature: HTTP requests occupy the fixed 32/128 client population, arrivals accumulate **before send**, and the original 1,000 ms client deadline produces `expired_before_send` plus the p99 cliff. Relaxing that deadline would conceal the failed SLO, not increase service capacity.

### Version and shared-host counterfactual

| Archived c985 / G6 | Offered /s | Passing repetitions | p99 range ms | Measured errors |
|---|---|---|---|---|
| g6-w1-b | 8,000 | 3/3 | 10.01–14.25 | 9 |
| g6-w2-a | 8,000 | 3/3 | 8.62–10.64 | 0 |

Both archived-source cells pass 8,000/s. **The historical read recovery does not require FF2.** This is not a claim that FF2 has zero performance effect: the replay uses the exact saved immutable message fixture, restored initial history, and later shared-host conditions. Coupled with the historical CPU timeline, it supports environment/cold-state sensitivity rather than an intrinsic old-release 5,656/s W2 ceiling. The precise competing process or original burst trigger remains unproved.

The original failing W1 B 4,000/s repetitions show about **11.88–11.98 busy logical CPUs** while the recorded serving+generator processes consume only about **2.04–2.08**. Original W2 A 8,000/s windows similarly show about 11.5–11.6 busy logical CPUs. PG/proxy CPU was not collected in that old outer sampler, so the difference is not an exact “unrelated CPU” count. The new complete PG/proxy sampler and host timeline close that measurement gap for this lane. A clean one-second start check does not reserve the shared machine during a 30-second trial.

## Generator ceiling

The original, unannotated generator runs against a small out-of-tree C epoll keep-alive server pinned to the ordinary app CPUs. Synthetic responses satisfy the unchanged W1/W2 normalization and validation; W2 returns 20 message-shaped rows. Authentication and database work are absent. This is a **generator calibration**, not another system in the product comparison. The generator remains pinned to **5,11**, one physical core with its SMT sibling.

| Payload | Highest complete pass /s | Passing p99 ms | Highest tested /s | Overload achieved /s | Generator CPU | Trivial server CPU |
|---|---|---|---|---|---|---|
| W1 | 32,000 | 31.59 | 64,000 | 35,854 | 1.99 | 0.61 |
| W2 | 16,000 | 20.35 | 32,000 | 19,683 | 1.99 | 0.60 |

All 42 calibration trials retain 10 s/20 s/three repetitions. At overload the generator consumes about **1.99 logical CPUs** on its two SMT threads; the synthetic server remains below 0.7 sampled CPU. Calibration overlaps native fixture seeding on the other CPU groups, not another rate measurement or a lane build; this is a demonstrated lower bound on generator delivery under those conditions. It does **not** establish an 8k universal ceiling. Payload-sensitive W2 does encounter a generator limit near 20k/s, so this one-host client would need attention for substantially larger W2 claims. [All calibration cohorts](./trivial-aggregate.json).

## Ranked fixes to test next — no fixes applied

These are proposals and conditional forecasts, not measured post-fix results. Preserve authority freshness, ownership fencing, FIFO, receipts, durability, the 32-member cap and existing SLO/error/counter rules.

1. **Remove connection construction from global reader locks, and make reader readiness explicit.** Reserve bounded construction slots; connect/qualify outside the global mutex and publish only after the existing epoch/generation checks. Consider preparing the fixed 30-reader population before readiness. This targets the cold convoy and first-cohort unknown-commit failures. Its predicted effect is to replace cold-burst latency with the measured warm-burst range above (about 10–11 ms); it does not by itself promise higher steady write throughput. The native recovered read rungs are 8,000 W1 B and 11,313 W2 A; preserving those through a concurrency increase is the immediate test.
2. **Improve batch fill under open-loop HTTP arrivals.** Test bounded coalescing within the existing 1 ms/32-member limits, maintaining FIFO and a low-load latency bound. This revisits the documented idle-never-waits policy and needs design review. The per-N median model predicts N=32 service rates around **2,100/s W4 A, 1,680/s W4 B and 1,684/s mix B** before added fill delay; a full extra 1 ms gives about **1,970/1,598/1,600/s**. These are capacity estimates, not passing offered rungs; use roughly **1.9–2.1k A /1.5–1.7k B** as the next experimental range.
3. **Fuse redundant serial round trips without changing the cut.** Candidates are fenced BEGIN/facts composition and folding G6's publication witness into the durable tail's returned values, retaining gate-before-COMMIT discipline. Saving two serial flights saves about **1.1 ms A /2.2 ms B**. At the present N≈16 that predicts only about **1.24k A /1.14k B**. Combined with N=32, the median model gives **2.27k A /1.90k B** before fill delay, still short of a demonstrated strict control win. Removing only the G6 publication query saves its measured 0.75 ms A /1.22–1.24 ms B; switching to G5 does not solve the write loss.
4. **Reduce actual durable flush latency and remaining serial CPU/tail work.** Keep fsync/synchronous_commit/full_page_writes enabled. Diagnose storage/scheduling of the observed ~2.6 ms sync, and optimize exact tail/codec/committer work. A hypothetical 2 ms lower real sync, after N=32 and the two-flight saving, gives about **2.64k A /2.16k B** in this model. It is conditional on achieving that physical improvement; no such improvement is measured here. Warm `/m` could use the existing nonauthorizing carried hint and retain fresh final authority, saving one parallel ingress statement per operation and its RTT, but the serial cycle still bounds throughput.
5. **Pack W2 cache entries and reduce hit-path/HTTP/response CPU.** Closing the approximately 400-entry deficit could reduce the native ~8% miss fraction; it does not imply a 30% native miss rate or removal of all PG/background work. G6 already qualifies 11,313 W2 A here. The unchanged generator passes W2 at 16,000 on trivial responses and saturates near 19,800, setting a payload-dependent limit for future one-host tests. W1 additionally needs lower serving/codec/proxy CPU within its fixed app budget: server+proxy consume about 3.78/4 logical CPUs at its failing rung. The trivial W1 32k result bounds the generator, not a proxy-inclusive product projection. There is no measured post-fix read-rate prediction beyond those conditional bounds.

The model fits all measured lightweight-probe batch medians by N, retaining every latency observation and using N bins with at least 15 samples. W4 A's R² is only about 0.45, versus about 0.81–0.85 for G6 B; A forecasts are especially uncertain. Filling to 32 and removing flights are not proven independent effects. [Model, bin counts and conditional rates](./batch-model.json).

Strictly beating the registered best controls needs the next ladder rungs: **4,525/s A** means N=32 cycle **≤7.07 ms**, and **2,262/s B** means **≤14.15 ms**, before latency/error headroom. Batch fill plus two saved flights alone does not substantiate those targets. This diagnosis identifies the remaining work rather than reporting a modeled win as a measurement.

## Custody, audits and cleanup

Independent unchanged auditors pass **210 HTTP load trials /12,499,112 measured intended arrivals**, including the excluded heavy observer arm, plus **42 trivial-server trials /18,026,760 arrivals**. The native subset is **120 trials /8,907,720 arrivals**. A separate before/after arithmetic audit checks all 120 write trials across observer/native arms; **5 of 72 native write trials fail equality, totaling 134 excess durable commits over acknowledgements**. Every native mismatch is the first 800/s repetition; four B cases lose 32 acknowledgements and G6 A loses six. Failures remain disqualified. [Independent audits](./trial-audit.json), [counter arithmetic](./counter-arithmetic-audit.json).

The host is expo-build-450b, OS hostname `expose-builder-pixel-a`, Ryzen 5 3600, six physical/12 logical CPUs. PG stays on 0–2,6–8, app/proxy on 3–4,9–10, generator on 5,11. All recorded thread masks match. There are **82 successful RTT captures**, max p99 **1.200 ms**; cell starts apply the inherited one-second unrelated-CPU rule. Minimum observed `/home` free is **90.00 GiB**, above both the commissioned 25 GiB guard and runner's 30 GiB floor. The release build uses lane-owned `snapback4/target/s1-wd`. No lane build overlaps native qualification. The final trace build inherited the generator core initially; its recorded compiler threads are allowed other CPUs only after all native qualification has ended.

One extra-control startup is rejected by the unexpired prior-owner lease after the last native service is stopped. The parent campaign then completes its unchanged cleanup. Two restored-fixture setup attempts are retained (PG recovery not yet ready; an infinite expired-lease sentinel in the diagnostic wait calculation); neither launches a load cohort. The successful recovery waits for database readiness and finite prior-lease expiry without changing product ownership rules. No failed repetition is replaced.

The unchanged native ELF SHA-256 is `be7b020d29acba28405c6724b71a77b69501ab241baab2724b46c4276ad11975`; original generator SHA-256 is `9c5675272ca897d4d54242a13ad4e47593d44c79bf0743adda907a679a34f9fb`. The native binary path is an exec launcher that enables only the existing count observer and execs that immutable ELF. Cargo initially reused an annotated generator artifact across manifest paths sharing a target; it was detected before native qualification and the archived exact S1-C executable restored. The archived `c985` product hash is `ada2789bf453603c01c2c2051c09b16cbed107466e934faf2382bc9be8ce999f`. Source/binary receipts, probe source copies/patch scripts and all observer arms are retained in the raw archive. [Verification](./verification.json).

Raw evidence is outside Git at `/home/ccheever/sb4scale/archive/s1-diagnosis-20261025.tar.gz`. **SHA-256: `5d66635f4471b8c4e0d7145ce5cb8b90259e4879e989d136c2cd6114003c2259`**. The archive retains all observer/native/legacy/async/trivial repetitions and failures, numeric per-request/per-batch traces, samplers, source/binary custody and rejected setup attempts. Only bounded derived aggregates and the report enter Git. [Archive receipt](./archive.json).

**PIDs left: none.** All owned services, delayed-link proxies, generators, private PostgreSQL processes, observers and controllers are stopped. PID/start identities, socket/pidfile absence and cleanup receipts are checked independently. Known-secret scanning precedes removal of the owned private credential directories; the stopped physical backup is removed and not archived. The initial scan flags only an unused public vendored TLS example key in the out-of-tree source copy; its matching source digest is recorded and that example is omitted before the clean scan and archive. [Exclusion receipt](./public-example-exclusion.json). A separate staged-delta scan precedes the local commit. No fetch, push, publication, paid resource, stash, Git configuration change, durability relaxation or unowned signal is used. [Process audit](./process-audit.json), [secret/cleanup receipts](./secret-audit.json).

Repository validation covers reference/metadata integrity, packaged-document lint, the documentation budget and its named self-containment test, JSON/link integrity, report arithmetic and whitespace. The affected selector is retained as a plan: it classifies experimental result paths as unknown and widens to the full product battery. This local documentation commit makes no complete-battery or publication claim. [Repository checks](./repository-checks.json).

Governing context: [controls RFC §§3–5](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md), [S1 method](../../../../llp/3000.009.001.002-scale-limits-against-postgres-controls.rfc.md), Snapback 4's separate fence and the paved release-JSON guide. This report records measurements and proposed follow-ups, not an adopted product design change.
