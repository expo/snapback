# G3b-par: parallel bounded overlays and batch CPU

2026-10-24, expo-build-450b (`expose-builder-pixel-a`), lane `sb4-pg/g3b-par`.
Base **976fc81e92**; CPU lane commits **e491040c39 / d036159171** replay as
**cb6411684c / edf12e5142**. Implementation **d94d61f40c**, review corrections
**12d375a70c**. This is a private durable PG16 release core-queue diagnostic,
not the matched S1 offered-load/HTTP/control campaign or publication evidence.
The governing design is the [controls RFC §3.3/§6](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md).

## Result

At N≤32, W4's clean median rises **2,582.8 → 3,422.8 writes/s** (+32.5%).
All three after windows exceed 2,262/s; two exceed 3,200/s, with one at
3,053.7/s. The median alone is not a qualified 3,200 offered-rate/SLO cell.
W5 shared remains ordered and its median rises **2,371.8 → 2,536.1/s**
(+6.9%), with overlapping ranges. W4 N=1 is **228.9 → 229.8/s**;
there is no pool work on N=1. The smaller cells' ranges do not establish
an independent throughput gain or statistical latency equivalence.

Whole committer CPU at N≈32 is **5.570 → 3.171 ms/batch** for W4,
**174.77 → 99.50 µs/member**. W5 is **6.386 → 5.929 ms/batch**,
**200.53 → 186.93 µs/member**. W4's after range is **94.94–103.93 µs/member**:
100 µs is a diagnostic median, not a bound on every trial or the HTTP path.
Parallel W4 also spends **3.851 ms/batch of worker CPU**, including pool
work. Writer plus workers rises about **5.57 → 7.02 ms/batch**. Parallelism
buys a shorter serialized path with more aggregate CPU; it does not erase E.

## Executor and serial equivalence

One process-wide Rayon pool is capped at `min(available CPUs − 2, 8)`
workers; below two workers, on pool-creation failure, or with fewer than two
speculative jobs, execute inline. N=1 never enters the wave or initializes
the pool. There is no runtime execution-mode selector in the final binary.

The existing selector closes all eligible point/rule dependencies before
execution, within its unchanged 32 MiB declared fact reservation. The pool
receives immutable base facts, borrowed schema/IR and owned contexts, never
a transaction, invocation/authority callback, or another member's overlay.
Each member writes private images/read sets/meters/change evidence. Return
prepared results by input position, accept in revision order, and discard and
re-execute a read conflict after accepted predecessors entirely in memory.
Known shared-target writers run once in revision order, so the all-shared W5
fixture does not use worker interpretation. Fresh authority, keyed receipts,
sequence allocation, intermediate images, tail validation and publication
stay on the committer. Facts precede interpretation, which completes before
apply and COMMIT; useful interpretation overlaps neither collection nor flush.

By induction, after acceptance j the merged state equals serial execution of
1…j: unchanged observed facts admit the private result; a changed observed
row forces a fresh attempt over that exact predecessor state. Discarded speculation loses its tentative images and charges. A refused
member rolls back its program images and preserves its ordinary refusal
meters/outcome. The same ordered protocol then persists intermediate results
and receipts. The original eligibility exclusions,
rollback/unknown-COMMIT handling, five/six warm flights and durability remain.

The new differential pairs parallel and forced-serial overlay execution for
three seeds × 192 members × N=8/32 on both stores: **12 paired histories**,
comparing every outcome/meter and complete durable snapshot after each batch.
Snapshots include rows, receipts/bindings/times, sequences, commits, evidence,
effects and intermediate log images. Adversarial absent/hot targets, hidden
rule failures and mid-body refusals complement the existing N=1 history
oracle. Both modes also run the 16-member predecessor chain (15 reruns),
duplicate receipts/mixed fallback and public intermediate-image witnesses.
The separate worker test requires multiple named workers on this 12-CPU host,
checks ordered results and the eight-worker cap, and checks singleton inline
execution. Final check outcomes are recorded below.

## Profile and cost cuts

Nested `CLOCK_THREAD_CPUTIME_ID`/monotonic spans measure stage CPU and wall
with child spans subtracted. Whole-committer and whole-worker CPU use external
5 ms `/proc/<pid>/task/<tid>/schedstat` samples aligned with the timed windows;
the largest recorded sample-to-window timestamp alignment offset is
**3.28 ms** over a three-second window. Millisecond-rounded window starts and
sequential counter reads add timing uncertainty; this is not a complete error
bound.
The whole-writer remainder includes queue intent construction, private binding,
classification, continuations and instrumentation residuals outside the batch
attempt. Pool CPU outside interpreted bodies remains in the worker total.
No overhead is subtracted. Stage medians need not sum to total medians.

CPU trials use the same counterbalanced order as rates, three windows per arm
and shape at N≤32, with a separate one-second warmup / three-second timed
phase. GNU gprofng at 1 ms also retains native call trees and function profiles.
The host has `perf_event_paranoid=4`; no perf-derived claim is made.

Each cell below is **µs/batch / µs/member**. Interpretation is committer CPU
except the explicitly marked W4-after worker cell. It is excluded from that
arm's serialized writer total. Conflict checks include zero reruns for these
two benchmark shapes: W4 is disjoint and known W5 collisions avoid speculation.
The adversarial differential separately exercises reruns.

| CPU stage | W4 before | W4 after | W5 before | W5 after |
| --- | ---: | ---: | ---: | ---: |
| Fact collection + JSON decode | 570.1 / 17.89 | 541.6 / 16.99 | 592.7 / 18.61 | 585.6 / 18.39 |
| Fact request encoding | 111.8 / 3.51 | 10.2 / 0.32 | 224.6 / 7.05 | 34.9 / 1.10 |
| Interpretation | 1,865.2 / 58.52 | 2,871.3 / 90.09 **workers** | 2,629.4 / 82.56 | 2,577.4 / 81.26 |
| Conflict validation | 39.1 / 1.23 | 39.7 / 1.24 | 32.9 / 1.03 | 33.5 / 1.06 |
| Ordered member handling | 755.6 / 23.71 | 769.6 / 24.15 | 1,128.7 / 35.44 | 1,115.0 / 34.99 |
| Overlay apply | 15.4 / 0.48 | 34.4 / 1.08 | 20.9 / 0.66 | 28.1 / 0.89 |
| Image + payload encoding | 195.7 / 6.14 | 50.8 / 1.59 | 116.7 / 3.66 | 28.3 / 0.89 |
| Tail assembly | 104.1 / 3.27 | 43.3 / 1.36 | 74.9 / 2.35 | 14.8 / 0.47 |
| Driver + literal/result codec | 695.8 / 21.83 | 635.9 / 19.95 | 702.3 / 22.05 | 690.1 / 21.76 |
| Attempt framing | 416.9 / 13.08 | 294.1 / 9.23 | 80.6 / 2.53 | 80.4 / 2.53 |
| Outer queue/intent/finish | 800.4 / 25.11 | 751.9 / 23.59 | 782.6 / 24.57 | 780.6 / 24.61 |
| Whole writer | 5,570.2 / 174.77 | 3,171.4 / 99.50 | 6,386.3 / 200.53 | 5,929.5 / 186.93 |
| Worker CPU | 0.0 / 0.00 | 3,851.1 / 120.78 | 0.0 / 0.00 | 0.0 / 0.00 |
| Off CPU | 7,132.3 / 223.84 | 8,116.8 / 254.53 | 7,153.8 / 224.63 | 7,069.3 / 221.81 |

Whole-writer off-CPU time includes SQL/flush/scheduling and waiting for workers,
plus phase framing; it is not a PostgreSQL-server or WAL-only measurement.
The instrumented cycle medians are W4 **12.51 → 11.30 ms**, W5
**13.54 → 13.06 ms**. Use the clean rate trials below for throughput.

The call trees show allocation/cloning in the fact/tail JSON trees and text
result conversion. Cuts preserve Rust rules and logical meters:

- Serialize borrowed fact and tail records directly rather than building
  per-field `serde_json::Value` trees and copying strings. By-id accesses omit
  unused encoded ranges; unique probes use the shared hex encoder.
- Borrow commit/log/effect/presence/receipt records during payload assembly;
  scope image borrows before the apply flight and buffer clear. Preserve all
  count assertions and intermediate tail records.
- Consume decoded Datum buffers into driver rows; TEXT uses `into_bytes`,
  BYTEA moves its Vec, and arrays consume children. Parsing, types and refusal
  ordering remain unchanged. This small result-conversion cut alone has no
  isolated established CPU gain.
- Sample a speculative sequence once only when jobs exist. Hot SQLite waves
  retain their prior access schedule; singleton execution is unchanged.

Fact encoding falls W4 **111.8 → 10.2 µs/batch**, W5 **224.6 → 34.9**;
image/payload encoding falls **195.7 → 50.8** and **116.7 → 28.3**.
Remaining serialized costs include ordered member/authority handling,
classification/private intent binding and driver/codec work. W5 interpretation
remains serial. The old CPU lane's 363.7 µs/member on the non-overlay path is
not this composed batch baseline, and must not be added again to these cycles.

## Clean rates and scope

| Workload | N cap | Before writes/s, median (range) | After writes/s, median (range) | Before → after p50 / p99 ms |
| --- | ---: | ---: | ---: | --- |
| W4-disjoint | 1 | 228.9 (222.8–243.0) | 229.8 (228.6–234.9) | 138.92 / 158.74 → 139.67 / 151.92 |
| W4-disjoint | 8 | 1,281.0 (1,216.2–1,284.8) | 1,305.3 (1,239.9–1,342.6) | 25.48 / 30.83 → 24.71 / 34.89 |
| W4-disjoint | 32 | 2,582.8 (2,577.2–2,633.4) | 3,422.8 (3,053.7–3,593.3) | 12.72 / 15.27 → 8.84 / 12.67 |
| W5-shared | 1 | 197.1 (192.8–201.1) | 204.2 (202.4–207.7) | 156.99 / 261.57 → 153.63 / 201.97 |
| W5-shared | 8 | 1,227.1 (1,213.3–1,283.3) | 1,304.3 (1,271.4–1,394.3) | 26.28 / 33.09 → 22.47 / 32.80 |
| W5-shared | 32 | 2,371.8 (2,324.9–2,789.6) | 2,536.1 (2,506.6–2,564.1) | 13.15 / 18.95 → 12.77 / 15.20 |

There are **153,890 timed acknowledged writes**, zero primary errors, exact
counter sums including warmup and exact batch-fill/member reconciliation in
every window. The release build omits test-only physical-commit counters;
those are not asserted as zero or presented as measured timings. Controlled
RT0 qualification supplies the physical flight witness. Mean N=8 fills are
7.99; median N=32 fills are W4 31.87 → 31.90 and W5 31.86 → 31.88.

The fixed primary order is **before / after / after / before / before / after**;
N orders alternate `1,8,32` / `32,8,1`, both shapes per invocation. No lane
compiler, sampler or qualification run overlaps the clean rate windows.
Recorded one-minute load at rate-window edges is **1.62–7.01** on
12 available CPUs; continuous sanitized host observations remain outside Git.
No host reservation is implied. All primary windows are retained.

The workload is the unchanged S1 Quarry `increment`, native live-account
credentials, one fenced owned queue and 32 closed-loop Rust producer threads.
W4 uses 32 owner counters; W5 uses one shared counter with all 32 membership
checks. It is the exact shared shape, not the nominal one-percent mix. One
request remains outstanding per writer. HTTP ingress/response processing,
delayed links and the million-message capacity fixture are excluded. N is a
cap, not a claim that every drained batch has exactly N members.

Private PostgreSQL **16.15**, master **626337**, TCP **127.0.0.1:55477**,
1 GiB shared buffers, 400 connections, JIT off, fsync/synchronous_commit/
full_page_writes on; owner renewal every 700 ms. Checks use the same private
cluster via its Unix socket, with the public witness's separately owned PG16
cluster. Rust **1.97.0**, release optimization and line tables, ten Cargo jobs,
all builds in the commissioned `snapback4/target`. No RUSTFLAGS change.
The external harness uses the product dependency pins; only the new Rayon
closure is added after. The original G3b's 1,883.5/s used opt-level-1 tests on
450a; comparing that directly with these release rates would conflate host,
profile and code changes.

## Qualification and review

The corrected affected program-batch sweep passes **38/38**, including both
new parallel/serial histories and the retained PG fault matrix. The separate
worker test passes **1/1**. A fresh same-family read-only review at
**12d375a70c** reports **no material finding remains**. It caught and verified
fixes for an image borrow surviving through a tail clear and a speculative
sequence sample unnecessarily adding a statement on all-hot SQLite waves.
An independent read-only measurement review recomputes the primary rate,
latency, CPU, off-CPU and load summaries and reports no material finding after
clarifying refused-member meters and timestamp alignment uncertainty.
The pre-fix sweep is retained (**23 passes / 15 failures**); the corrected
sweep above replaces no failure record and uses the original test budgets.

Controlled core RT0 on the corrected source:

| Shape | N | PG exchanges | SQLite statements |
| --- | ---: | ---: | ---: |
| W4 | 1 | 7 | 21 |
| W4 | 8 | 5 | 87 |
| W4 | 32 | 5 | 327 |
| W5 shared | 1 | 10 | 24 |
| W5 shared | 8 | 6 | 59 |
| W5 shared | 32 | 6 | 203 |

The complete `bash scripts/test-postgres.sh` exits **1** with exactly the
retained evaluator Serializable `40001` at `conformance.rs:294` / join :307:
**21 passed / one failed / three existing filters**, 594.00 seconds. The
[existing ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
records this occurrence. All later scopes pass: 232 adapter, 13 evidence,
21 literal/codec, 25 ownership, 60 evolution, 38 program-batch, six
outcome/deadline, 15 command, 62 authority-boundary, 22 supported corpus,
11 differential-library and four store-campaign tests, plus retained
committer/maintained-member, handle, device, key-limit and evaluator-oracle
scopes. No retry, timeout, durability or exclusion changes are made.
The corpus completes in 973.06 seconds; its intentionally planted negative
controls fail internally and pass their enclosing assertions.

Public CLI qualification passes EV-1/EV-2 restoration and wire/meter parity
(1,538,672 bytes for EV-2), change-evidence/SDK parity, 300 KiB change cases,
restart, SIGKILL takeover, ownership loss, non-superuser serving and the
unchanged S1 Quarry P1-MC journey. Every room/user total equals recount.
The public cluster, master **1033296**, is stopped with separate status 3
and no pidfile. No clean full-script pass is claimed because the retained
evaluator red remains.

The full core run passes **746 unit tests**, **413 integration tests across
47 targets** (44 nonempty; three with only existing ignores), and **38
doctests**, zero failures. Named ignores: 290 unit / 50 integration; the private PG differential is
explicitly enabled in the passing private sweep.
The census excludes the separate filtered worker-process summary from the
primary unit count. Full `snapback4` binary tests pass **577 / zero failed /
45 named ignores**. Both RT0 ratchets pass **five cases**: warm PG group totals
N=4/8/32 remain **5/5/5**, SQLite **34/58/202**, with the existing N=1 HTTP
allowances. Normal and final release builds pass with locked dependencies and
ten Cargo jobs. `./ref-check` passes (567 LLP documents, zero errors and zero
unchecked references), and whitespace validation passes. References are
repeated after the final journal/custody update. No whole-script green or
publication qualification is asserted.

## Process custody

Private PG16 masters **626337** and **1033296** are stopped. Separate
`pg_ctl status` calls return **3** for both recorded data directories; no
postmaster pidfile or Unix socket remains. TCP port 55477 has no listener.
Both load/disk observers are stopped and reaped.

The independent final audit checks **3,972 distinct recorded PIDs**: all are
absent, with no reused PID, executable from the owned target, owned postmaster,
or raw-path helper left running. **PIDs left: none.** Minimum observed `/home`
free space is **41.02 GiB**; final audit free space is **51.28 GiB**, above the
30 GB stop threshold. The disk-stop condition never fires.

Only owned target artifacts are cleaned: 21.3 GiB of stale debug package
artifacts, 8.4 GiB of unused release package artifacts, and 13.3 GiB of debug
incremental cache after verifying no owned compiler was active. Measurement
binaries and raw evidence remain intact. No stash, push, global Git
configuration change or operation on another cluster occurs.

## Retained pilots and artifacts

The first release integration-test build refuses `test-support`, as designed;
measurements therefore use an external release harness adapted from the
existing `overlay_measure` test. A temporarily exposed Fixed(N) constructor,
all clocks/unsafe clock wrappers and the profiling module are absent from
final source. Clean rate binaries contain no stage clocks or sampler.

The initial harness pilot fails on a test-only physical-commit counter
assertion after its durable counter/fill checks pass. The corrected harness
removes that unavailable assertion. Earlier socket/TCP clock pilots remain
raw evidence, including the first TCP W4 outlier at 289.1/s. An initial
whole-thread observer races an exiting thread; its stage clocks remain valid,
but the primary whole-thread table uses the later corrected, counterbalanced
six-run clock series with complete coverage. Nothing is silently relabeled.

Raw logs, sampled experiments, call trees, clocks, lock snapshots, sources,
loads, PID records and primary private data stay in **`/tmp/sb4-g3b-par/`**.
The stopped public witness retains its artifacts under
`/tmp/s10d3-serve-n9ew0acj/`. The primary
clean records are `paired-0-before` through `paired-5-after`; CPU records are
`clock-profile-0-before` through `clock-profile-5-after`. Native samples are
`before-sample-tcp.er` and `after-sample-final.er`. Earlier failed setup and
pre-correction test runs are retained there as well. No raw profiles/logs or
credentials are committed.

Clean binary SHA-256:

- before: `19887ddf781a1912b4ab231744d5bd6bfed4a1ac69daddb5284493b88b43ac3f`
- after: `c231935cfc4b325bccfc93f1c20249cf9ddf774b6a6876db8bdc2db986fa9ce6`
