# BP round 0: the Mac growth does not reproduce on ten Linux CPUs

2026-09-29. Branch `sb4-intent/bp-foreground-first`, base `4fd338de5`.
No scheduling change, push, publication or ceiling increase.

**The several-fold growth did not reproduce. Following's pending queue grew
larger than SQ's, but requests did not queue behind parallel background
workers: delivery, recounts and jobs already share one maintenance thread.**
The user's conditional stop applies. This landing records the experiment,
retains the existing policy in LLP 3000.013 §4, and supplies a build-free Mac
live-replay script. It makes no performance-fix claim.

The full warmed search and trending midpoint rules still fail, by 0.482 and
0.511 ms. All batches remain in the evidence; these failures are not waived
because the several-fold curve is absent.

## Live reproduction

Host: `expose-builder-pixel`, Linux 6.8.0-138-generic, AMD EPYC 9454,
48 physical cores / 96 logical CPUs. Node 24.13.1, Bun 1.3.14, Rust 1.97.0.
Server and replay were both launched with **`taskset -c 0-9`**. Every sampled
server/replay thread reports affinity `0-9`; warm probes, verification and
snapshot subprocesses inherit the replay's affinity. These are ten distinct
physical cores; their SMT siblings 48–57 remain available to other lanes.
This is confinement, not exclusive CPU reservation. Other lanes stayed active.
No BP compiler or test ran during replay, probes or drain.

The server was built here from `4fd338de5` in the packaged `production`
profile with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, adding only
reversible measurement hooks. Diagnostic SHA-256:
`7fc44fee783a7879b830e9f6b387153e181f3e3ca3e9cbe61451e74b29e66e0b`.
The online SDK was built from this checkout. SQ measured `f56e8048a`, which
included LV; this commissioned base includes the later LV revert. Consequently
the SQ-versus-BP numbers are **not a controlled CPU-count-only comparison**.
The experiment here tests growth within one fixed build and CPU set.

SQ's actual replay adaptation is reused: original ordered mutations, uploads,
IDs, exact checkpoint-prefix/hash checks and complete `verifyScale`. Only
fresh private output, binary and port are substituted. The three starter logs
and **all 167,157 scale actions** ran, with zero failed actions, both checkpoint
verifications and final verification passing. The receipt reports 577.715
active seconds. The frozen scale fixture SHA-256 remains
`b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
No PF/SQ store was served or modified.

The live server is `dev --replay --no-watch`: effects suppressed, schedules
held, maintenance and Following delivery active. Immediate probes run in the
replay process with its existing clients, before verification or warmup.
First reads began **17 / 41 / 11 ms** after the last action's recorded
settlement at 10% / 50% / full. Hook entry is recorded separately. SQ's
warmed protocol follows: three warmups per probe, then nine batches of ten
reads, in a separate inherited-affinity process. Checkpoints are monotonic;
their order cannot rotate during replay. As in SQ/PF, sorted item 4 is p50;
item 9 is p95 and max. The warmed table is the median of nine batch p95s.

| Immediate p95, ms | 10% | 50% | Full |
| --- | ---: | ---: | ---: |
| Busy history | 2.472 | 2.958 | 2.191 |
| Following, 500 | 4.340 | 4.572 | 3.934 |
| Following, 5 | 2.631 | 3.201 | 4.229 |
| Celebrity follower | 2.919 | 2.566 | 4.755 |
| Search | 4.887 | 4.703 | 7.235 |
| Insights | 1.208 | 1.281 | 2.096 |
| Trending | 3.530 | 1.560 | 3.059 |

| Median of nine warmed batch p95s, ms | 10% | 50% | Full | Full / small |
| --- | ---: | ---: | ---: | ---: |
| Busy history | 2.365 | 2.207 | 2.501 | 1.057× |
| Following, 500 | 3.691 | 4.001 | 3.744 | 1.014× |
| Following, 5 | 2.577 | 4.254 | 4.141 | 1.607× |
| Celebrity follower | 2.668 | 4.188 | 4.946 | 1.854× |
| Search | 4.863 | 5.632 | 5.507 | 1.132× |
| Insights | 1.489 | 1.717 | 2.371 | 1.592× |
| Trending | 2.246 | 3.039 | 2.880 | 1.282× |

All 2,100 measured reads returned complete answers. [CURVES.md](CURVES.md)
also records p50/p95/max and every frozen read-rule margin; `summary.json`
preserves all nine individual rule sets. Warm midpoint pass counts are
search **2/9**, Insights **6/9**, trending **4/9**. Insights' full/small rule
passes **7/9**, so even that ratio has two individual failures. These remain
visible rather than selecting a favorable batch. Median full/small and both
full Following ratios pass. The original verifier's celebrity/5-follower write
ratio is **1.050549**, ceiling 3, margin **+1.949451**, from 200 and 8,096
writes. SQ's live protocol does not sample a separate nine-batch deep-page
curve; the unchanged verifier still checks busy-history paging.

## Attribution

The request path already reserves 32 short-read slots separately from writers
and waits. Fresh, identity-checked reader connections are independent of the
writer. `serve_maintenance.rs` runs Following, recounts, expiry, jobs and lease
sweeps serially on the `maintenance` thread; it does not spawn one worker per
task. The governed policy in `serve_lock.rs` coalesces a 1 ms quiet interval,
caps pre-ticket deferral at 5 ms and then uses FIFO admission. Contended work
gets a 250 µs cooperative slice, otherwise 2 ms, ending between atomic rows.
Durable commit I/O can extend that slice. These mechanisms predate BP.

The numeric diagnostic captures every request's Linux TID and thread CPU,
plus cumulative CPU by background kind on TID **4176484**. Sampled `/proc`
records retain all surviving threads, their CPU, affinity, states and priority.
Short-lived request threads can disappear between samples; their exact
CPU consumption remains in `BP_REQUEST`. Across replay and drain:

| Work | CPU seconds |
| --- | ---: |
| Request handlers, 174,473 recorded requests | 360.945 |
| Following work, one maintenance thread | 282.157 |
| View recounts, same thread | 0.125 |
| Jobs, same thread | 0.042 |
| Expiry, same thread | 0.036 |
| Action lease sweep, same thread | 0.008 |
| Effect lease sweep, same thread | 0.006 |
| Asset preparation, same thread | 0.002 |
| Schedules | Held by replay |

Background counters include empty attempts and admission work; they are
cumulative through the last approximately one-second diagnostic flush.
They exclude outer maintenance-loop/ephemeral work. The last process sample
reports **681.060 CPU seconds**, including exited threads. About **37.739 s**
are outside the attributed spans: listener/connection handling, other thread
work, diagnostic writes and sampling-boundary differences. No unmeasured
residual is assigned to Following. Detailed per-operation/per-thread records
are retained; no CPU total is interpreted as elapsed delivery latency.

| Warm reads, 630/checkpoint | Median / max request queue, ms | Max acquisition, ms | Engine median / p95, ms |
| --- | ---: | ---: | ---: |
| 10% | 0.095 / 0.425 | 0.001 | 1.086 / 2.810 |
| 50% | 0.099 / 2.212 | 0.001 | 1.578 / 3.239 |
| Full | 0.104 / 0.954 | 0.006 | 1.654 / 3.270 |

Every read retains paired client, server total, acquisition, engine and
request-thread CPU timings. Queue is HTTP acceptance to handler entry;
acquisition is actual reader/writer checkout; engine is wall ownership,
including I/O/descheduling. They do not identify a particular OS wait by
subtraction. The largest immediate queue sample was 2.238 ms. The several-fold
queue delay predicted by the hypothesis is absent at the measured checkpoints.

Host load was not uniformly low. Over the replay, sampled ten-CPU busy
fraction had median **24.34%**, p95 **95.03%**, max **96.69%**. Over the whole
replay/drain, the host's sampled runnable population on CPUs 0–9 had median 2,
p95 10 and max 20. Server/replay sampled runnable threads had median 1,
p95 2 and max 7. The kernel's global `procs_running` samples had median 8,
p95 106 and max 130 across all 96 logical CPUs. One-second CPU intervals
ending in the warm probe windows observed **28.54–30.14% / 31.47% / 33.77%**
occupancy and host runnable counts **2–3 / 4 / 2**.
Those short windows have only 2 / 1 / 1 one-second host samples. They cannot
exclude brief spikes between samples. The per-request timing evidence has
finer coverage and likewise does not show sustained probe queuing.

**Measurement limits:** R-state sampling includes executing tasks and is not
an atomic kernel queued-only runqueue trace. `/proc/stat`, global load and CPU
pressure are retained, but Linux scheduler-delay accounting was disabled
(`kernel.sched_schedstats=0`); zero schedstat delay is not evidence of no wait.
Observers keep host-wide affinity and add read-only queue scans. Their sample
duration has median 2.2 ms and p95 240.4 ms (the latter includes the one-second
queue/host census). Hooks add clock reads, query schedstat reads and log writes.
This is an instrumented reproduction, not an uninstrumented optimization
comparison. No kernel scheduling setting was changed.

## Backlog and stopping decision

| After warmed probes | Pending Following | Pending recounts/jobs |
| --- | ---: | ---: |
| 10% | 3,456 | 0 / 0 |
| 50% | 18,958 | 0 / 0 |
| Full | 36,569 | 0 / 0 |

Continuous sampling saw a peak of **41,389** pending Following tasks and no
parked Following work. The first all-empty observation was **172.278 s after
the final timed full-scale probe**; the previous nonempty sample was at
171.278 s. Verification and the consistent snapshot run during part of that
interval. After the replay command returned, the three-empty-sample drain
criterion took **168.269 s**. Raw samples preserve both origins.

The growing durable backlog is real, but it is not a growing population of
CPU-consuming background threads. The existing foreground admission policy
and one background thread explain why a large queue can coexist with prompt
reads in this run. This does not prove that background work cannot contend
on the Mac. It means this Linux reproduction does not justify changing its
priority/QoS, concurrency, cooperative yielding or batching.

Per the explicit stop condition, there is **no after optimization**, no new
scheduling regression test, and no claimed throughput/commit-to-delivery
tradeoff. Existing policy and progress tests are exercised below. The 5 ms
deferral cap is an admission bound, not an end-to-end latency guarantee;
atomic rows/commit I/O and a growing queue prevent such a guarantee. Every
meter, charge, ordering rule, durable cursor, incarnation check and copy
identity is unchanged. Operators see no change, so the operations manual
needs no new setting or policy.

## What the Mac still needs to distinguish

1. **Hardware and browser load.** Ten homogeneous EPYC cores with Linux
   scheduling do not recreate the M1 Max's eight performance and two efficiency
   cores or its concurrent browser. This harness uses the real Node mutation
   adapter/SDK, but its identity seam has no browser. CPU affinity alone cannot
   establish equivalent headroom, QoS placement or client event-loop load.
2. **Physical read work.** SQ directly observed background-commit reader-cache
   invalidation, with a smaller live/drained latency difference. That is a
   supported source of extra work, though neither lane demonstrates that it
   causes the Mac's several-fold curve. BP retains SQ's cache counters for
   actual server queries and changes no SQLite policy.
3. **Client versus server delay.** Repeated paired server timing on the Mac,
   alongside browser/replay/server CPU, can distinguish client delay from
   acquisition or engine wall time. A constant compiler work certificate does
   not promise constant OS wall time. The current Linux evidence cannot name
   the Mac's wait cause.
4. **Different source and noisy percentile rules.** Current `4fd338de5`, SQ's
   pre-revert source and calibration #25 are not identical software contexts.
   SQ's byte-identical control already flipped a midpoint verdict. Here each
   batch's p95 is the maximum of ten samples; search/trending median midpoint
   failures and individual Insights ratio failures persist without the broad
   slowdown. A passing lucky batch would not resolve either issue.

## Mac handoff and validation

With two native binaries, the private PF/SQ `replay/` template, Node 24,
Python 3 and this repository's already-built SDK:

```sh
snapback4/reports/20260929-bp-foreground-first/tools/macos-live-curve.sh \
  /path/to/before /path/to/after /path/to/private/replay /path/to/new-output
```

It builds and installs nothing. It runs all actions from fresh stores for each
binary, immediate reads then all nine warmed batches, verification and final
drain; prints the same table/margins; and records binary digests, samples and
host load. `BP_CPUS=0-9` selects Linux confinement. Native Mac binaries have
normal Server-Timing, not BP's Linux-only diagnostic hooks. No Mac execution
or before/after performance gain is claimed. The component pipeline completed
on Linux in the reproduction; the shell entrypoint has syntax validation.
See [tools/README.md](tools/README.md) and [evidence/README.md](evidence/README.md).

Affected tests passed: **8** FIFO/admission, **5** maintenance chunks,
**1** timeline delivery and **2** scale-complexity tests. Whole guide:
**98 passed**, zero failures. The existing explicit sustained-request witness
ran under CPUs 0–9 against the clean production binary: **1,339 reads**,
p95 **6.261 ms**, all **901** copies delivered in **460.272 ms** while eight
request streams continued. It is a progress witness, not a replacement for
the scale replay or a new scheduling guarantee.

Fresh canonical wasm from the full suite: **2,040,529 B raw / 592,975 B gzip**,
cap **593,719 B**, headroom **744 B**. SHA-256
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No device source or build policy changed; its difference from SQ is not a BP
size optimization. The clean production binary is retained with SHA-256
`5502b0763e668323400d65b568c800cd535c3b972b38e5b505f1f27588c43844`.

The full command ran **once**:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 bash snapback4/scripts/test.sh`.
It exited 1 with exact summary **`== 1 failure(s) in 2129 s`**, stage
**`client tests`**. Client totals: **4,560 passed, 1 failed, 10 declared skips**;
final client models: **79 passed**. Rust and all other stages passed.

The sole failure is **baseline fixture cleanup**:
`process: a genuinely empty partition at sequence zero is acquired durably`.
Its after hook's `rmSync` at `acquisition.test.mjs:64` failed **ENOTEMPTY**
while its device and server were still alive. The acquisition shard stayed
idle afterward for over ten minutes. To let this same suite finish, only
that recorded fixture's native child, test worker and server were terminated;
their PID/start-time checks and intervention timestamps are retained. The
runner preserved the original failure and continued to all final model tests.
No second full-suite run or replacement result was used.

The exact failed case then passed alone (**1 passed, 0 failed**, 1.267 s
process wall, no forced cleanup). This establishes an intermittent cleanup
failure on unchanged base code; it does not erase the suite failure or prove
shared-host load caused it. **Introduced failures: none. Baseline: the one
cleanup failure. Established environmental failures: none.**
[FAILURES.md](FAILURES.md) records all measurement/setup/test outcomes; the
[bounded follow-up](../../../issues/20260929-snapback4-acquisition-cleanup-enotempty.md)
tracks the inherited cleanup ordering and unbounded wait.

The documented 60-second total target was missed, as in SQ's 1,690-second
baseline. This run also includes waiting for the stalled fixture and its
explicit cleanup; the 2,129 seconds is not presented as a clean performance
comparison. No ceiling or timeout changed. Reference validation and the final
source diff confirm that only reporting/tools, the retained-policy record,
the journal and the cleanup ticket changed.
