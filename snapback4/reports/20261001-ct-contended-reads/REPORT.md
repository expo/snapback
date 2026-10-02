# CT round 0: contended reads

Persistent request workers remove per-request thread creation and preserve all
seven admission classes. Darwin request workers use user-initiated QoS; host
background work uses utility QoS, and Linux background work lowers its nice
value without privilege. At 96 busy processes on 96 available logical CPUs, the traced alternating
experiment reduces medians by 47–64% and p95 by 6–51% across eight endpoints.
**The complete performance target is not met, including the idle condition.**
The measurements and environmental limitations below are part of that result.
Nothing was pushed or published.

## Reproduction and custody

Base: `9845a1f013cf0c0a14194efecef86f865cfdc2a1`, branch
`sb4-intent/ct-contended-reads`. Host: eb1000 / `expose-builder-pixel`, AMD EPYC
9454, 48 physical cores / 96 logical CPUs. The primary all-CPU experiment uses 0/48/96/144 busy children. A separate
ten-CPU experiment confines Node,
the server and its busy subprocesses to CPUs 0–9. Thus its four loads are 0,
5, 10 and 15 busy processes against ten available CPUs; this is **not** a
96-CPU whole-host saturation claim. Other users of the host are not confined
or stopped. Node is 24.13.1, libuv 1.51.0; the client pins Undici 8.8.0.
The installed dependency lock is retained in `inputs/client-package-lock.json`.
Compiler, binary and input hashes are
in [custody.json](./custody.json); builds use the production profile and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` on both sides.

Copied the calibration #28 packet from the office M1 using scp. No harness,
build or test was run on a Mac. [inputs/packet.tar.gz](./inputs/packet.tar.gz)
contains its actual schema, generated operation descriptors, replay adapter,
probe/summary scripts and fixture logs/media. Its scale log is bound to the
builder's manifest hash. Replayed starter M1–M3 and scale through the actual
50% marker using the published 0.4.10 server and client: **88,143 settled
actions**, not a synthetic population. The original builder verification
[passes](./inputs/scale-verify-50pct.json): 1,008 profiles/users, 5,921 follow
edges, 25,128 posts, 1,002 conversations, 2,053 memberships, and 50,015 messages;
all per-chat counts and all 1,008 users' following/membership counts match.
The busy group's 5,000 messages require 250 API pages here; its 10,000-message
population is at the final checkpoint. The local 1.3-GiB store and minted
sessions are deliberately not committed.

The harness uses **published `snapback4@0.4.10` `createClient({url, token})`**,
with the adapter's real account credentials used only to obtain those tokens.
Each named endpoint receives 23 sequential `client.query` calls; samples 0–2
are discarded, then rank 19 of 20 is the cohort's p95. Five cohorts per cell
retain the original 20-sample percentile and also report pooled 100-sample
percentiles. No latency samples or refusals are silently dropped. All eight
normalized answer hashes agree across every load and both binaries; only
Insights' changing `asOf` timestamp is excluded. Query completeness and cursor
remain in the hash. The ordinary SDK change-feed connections remain active.

Busy children execute arithmetic loops, not I/O. The driver waits for each
child's readiness, allows two seconds of contention before probing, checks
that every child survived, and terminates/reaps only its recorded children.
The final script records CPU counters, process CPU and the eight busiest
processes at each load boundary. The initial series predates that extra host
sampling; its metadata and load averages are retained. The copied builder
[checkpoint probes](./inputs/scale-probes-50pct.json) and
[nearby host samples](./inputs/builder-host-load.json) remain separate from
this lane's measurements. All-CPU series use the final host sampling; their
load averages lag rapidly changing synthetic load, so inspect CPU counters and
owned-process samples too. The host has SMT: 96 logical CPUs share 48 physical
cores. Other lanes continued working throughout these runs.

## What changed

The governing serve/runtime decision is **LLP 3000 §7,
“Contended read serving” / “HTTP overload diagnostics”**. LLP 3000.019
§§3.6–3.7 remains the detached-reader and timing owner. The
[orientation record](./CONTEXT.md) names the other binding constraints.

- Seven lazy pools reuse request threads. Limits remain 32 short, 32 mutation,
  32 sync, 32 wait, 16 route, four registry and four verifier requests.
  Queued and executing requests both retain their original admission permit.
  A pending idle-worker wakeup cannot suppress expansion needed to serve
  admitted blocking handlers. Full capacity and failed thread creation retain
  the existing refusal bytes, counters and no-body-drain behavior.
- The pool retains unwind isolation and exits idle threads when its admission
  owner is dropped. The production panic-abort policy is unchanged. No engine,
  transaction, viewer or request is retained by an idle worker.
- macOS request workers explicitly select `QOS_CLASS_USER_INITIATED`.
  Dispatch, accept/parser threads, maintenance/jobs, schema watching, supervised
  worker processes and output threads select utility QoS. The HTTP library's
  optional host hook defaults to no policy. Linux background threads and
  worker processes lower nice to at least 5. Linux's dispatch and HTTP parser
  threads retain inherited priority so their request children do not require
  privilege to restore ordinary priority. No real-time policy or privileged
  priority increase is requested.
- File-backed reads already bypass the fair writer mutex, including token
  authentication. Engine wait is zero in these traces, so the FIFO and reader
  custody remain unchanged. A new lock design is not supported by this result.
- KA already supplies connection reuse: the first series uses four query
  sockets before and three after for 3,680 queries per binary. Its retry and
  snapshot contracts remain intact; no token-client code changed. The 35
  affected KA/transport cases pass.

## Timing and interpretation

The opt-in `SNAPBACK4_READ_TRACE` path must name a new file; the harness adds
only a numeric request correlation header. The trace contains no token,
argument, principal or answer. Its disabled path retains no sample. The same
[instrumentation patch](./inputs/instrumentation.patch.gz) was applied to the
base and candidate. Normal latency registry semantics are unchanged.

All client/server stamps use a host monotonic clock: Linux `CLOCK_MONOTONIC`
and Darwin `mach_continuous_time`, matching Node's
[libuv 1.51.0 Darwin implementation](https://github.com/libuv/libuv/blob/v1.51.0/src/unix/darwin.c#L56).
The script asserts cross-process ordering; it does not align wall clocks.
Parser acceptance is reconstructed from tiny_http's existing `accepted_at`
Instant with an adjacent monotonic sample. A preemption between those samples
can bias reconstructed acceptance early; that uncertainty was not independently
stamped. Treat the two acceptance-related spans as approximate. The main
dispatch/run, query, encoding, write and client-callback conclusions use direct
monotonic stamps and do not depend on that reconstruction.
On reused sockets there is no new OS accept per query. `sendToAccept` includes
loopback delivery, parser scheduling and request-header reading;
`acceptToDispatch` includes small-body prebuffering and the listener queue.
`dispatchToRun` includes classification, spawning/enqueueing and first execution.

The first socket `data` callback marks when the client event loop runs. It
does **not** establish the kernel packet-arrival time: `responseToWake` includes
loopback delivery, response writing and event-loop scheduling. Write and client
callback can overlap on different CPUs. Lock waits, query wall time and reader
ownership can overlap too; their percentiles must not be added. Encoding covers
JSON serialization/drop; HTTP framing is between encoding and the write.
The `readerLock` column measures checkout acquisitions; reader-return and
reader-metadata mutex acquisitions remain in `otherLocks`, together with
small handler/registry bookkeeping. These limits
are explicit rather than labeling an unmeasured residual as pure scheduler time.

The first baseline reproduces the requested distribution shift: at 10 busy
processes, following-500 median/p95 goes from 2.436/4.586 to 3.708/7.094 ms;
page-50 goes from 1.047/2.099 to 2.431/4.923 ms. Search execution median stays
2.037→2.041 ms and following-500 execution median stays 1.228→1.214 ms.
Dispatch-to-first-run tails rise from roughly 0.1 ms to 2.7–3.0 ms, while
response-to-client-callback tails reach 2.2–3.4 ms. Reader/other mutex waits
remain tiny, engine waits zero. This attributes the main growth to handoffs
and client callback scheduling, rather than a larger query or writer convoy.

[RESULTS.md](./RESULTS.md) reports every endpoint's p50/p95 at all four loads.
[STAGES.md](./STAGES.md) reports every stage for every endpoint/load.
Each result directory also retains all raw client/server stamps, per-cohort
rank-19 percentiles and binary/host metadata. The first after-series lowers
full-contention p95 by about 8–31% across the eight endpoints. Six endpoints
meet both ratios against that series' own idle values; Insights p95 is 1.70×
idle and page-50 p95 is 1.55×. Its idle medians are higher than the earlier
baseline, which ran at host load 16 rather than 43. This first comparison
therefore establishes neither a clean idle regression nor its absence.


## Full-host result and idle controls

The [all-CPU results](./ALL_CPU_RESULTS.md) and
[stage table](./ALL_CPU_STAGES.md) pool two complete matrices per binary in
before/after/after/before order, 200 retained samples per cell and ten separate
rank-19 cohorts. For example, at 96 busy children:

| Endpoint | Before p50 / p95 (ms) | After p50 / p95 (ms) |
|---|---:|---:|
| home, following 500 | 7.608 / 13.903 | 4.038 / 9.741 |
| home, following 5 | 6.844 / 11.471 | 3.305 / 9.590 |
| celebrity following | 6.345 / 13.734 | 3.322 / 9.792 |
| search coffee | 9.511 / 14.249 | 4.388 / 10.781 |
| Insights | 3.051 / 6.936 | 1.091 / 3.386 |
| Trending | 3.883 / 7.048 | 1.831 / 4.746 |
| history page 1 | 3.356 / 6.878 | 1.459 / 4.499 |
| history page 50 | 3.095 / 6.752 | 1.543 / 6.340 |

Baseline dispatch-to-first-run median rises from 0.06–0.07 ms idle to
1.0–1.4 ms at 96 busy children, with p95 around 2.6–3.0 ms. Persistent-worker
medians there are 0.009–0.013 ms; search p95 falls from 2.885 to 0.173 ms and
Insights from 3.044 to 0.040 ms. Engine wait remains zero and mutex waits are
microseconds. At whole-host saturation the query itself also slows: baseline
search execution median rises 2.060→6.341 ms; candidate execution at that load
is 3.335 ms. Response/client-callback scheduling remains material (page-50
p95 3.582 ms after), as do response-write wall spans. Those spans include
preemption before the completion stamp, not just time inside a socket syscall.
Thus a faster dispatcher cannot by itself establish the end-to-end target.

All eight candidate full-contention p95/idle ratios exceed 1.5 (1.51–3.18).
Home-500, celebrity-following and page-50 also miss the median ratio
(page-50 is 1.253×, just above the threshold). Idle search median
is 10% higher, and some idle tails are 34–51% higher. At 144 busy children,
four candidate tails regress versus baseline; these are retained in the table.
The candidate is retained for its structural reduction and substantial
full-contention improvement, **without a no-idle-regression qualification**.

The separate [ten-CPU idle ABBA controls](./IDLE_RESULTS.md) confirmed a larger
idle regression in that interval: home-500 median 2.499→4.106 ms. Server CPU
and query execution grew too, not just wakeup time. In
[one-CPU ABBA controls](./ONE_CPU_RESULTS.md), the query-execution increase
disappears and all eight client medians improve 1–11%; several tails still
regress. This supports a placement/frequency interaction as a hypothesis,
not a demonstrated cause. No affinity or CPU governor policy enters the product.

`hint-*` retains exploratory unprivileged Linux `uclampset` minimum hints of
512/1024 on this harness's own request threads, applied by the preserved
[experiment script](./inputs/uclamp-experiment.mjs). Results were inconsistent:
one 1024 pilot improved idle, a later 512 run slowed query execution, and an
unhinted run also had fast query execution. No utilization clamp, real-time
priority, privileged operation or busy-process priority adjustment was retained.
The ordinary background nice policy and Darwin QoS policy remain as stated above.

[Tracing-disabled ABBA matrices](./UNTRACED_RESULTS.md) confirm that the
qualification failure is not confined to trace overhead. At 96 busy children,
all eight medians improve over baseline (26–61%), seven tails improve (2–34%),
and celebrity-following p95 regresses 16%. Seven endpoints still miss the
1.5×-idle tail target; search also misses the median target (2.107×). Idle
home-500 median regresses 36%, while six other medians improve. At 48 and 144
busy children all eight medians and tails improve. The trace and untraced
series ran at different times on the shared host; subtracting them would not
isolate instrumentation cost. Keep both series, not the better one.

All **49,680** successful sampled queries across the retained experiments
have identical normalized answer hashes per endpoint. The only excluded
answer field is the documented changing `asOf` timestamp. The retained
`summarize.py` regenerates the comparison/stage tables from the raw stamps;
raw samples, traces, per-run summaries, logs and the baseline patch are
gzip-compressed without dropping records or changing their bytes.

## Reproduce on Linux or macOS

From `snapback4/`, build the candidate with `bun install --frozen-lockfile`
and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production`.
Node 24 and npm are required. The fixture archive is local to this report;
`--prepare` installs the pinned published client into the private work directory.

```sh
node scripts/contended-reads.mjs --prepare --work /tmp/ct-store --binary target/production/snapback4 --out /tmp/ct-prepare
node scripts/contended-reads.mjs --work /tmp/ct-store --binary target/production/snapback4 --out /tmp/ct-after
```

Preparation refuses an existing store; subsequent measurements reuse it.
For the baseline, create an isolated checkout at the base commit, apply this
report's `inputs/instrumentation.patch.gz` (decompress with `gzip -dc`) from
its repository root, and build
with the same production command/toolchain. Pass that absolute binary path to
the same script and store, using a fresh output directory. On Linux prefix
each measurement with `taskset -c 0-9` to reproduce the ten-CPU experiment;
omit the prefix for all available CPUs. On macOS omit taskset. The script
chooses half/all/1.5× available CPU counts automatically. `--rounds 5` is the
default; `--levels 0` isolates idle controls. `--no-trace` measures without
the optional trace file, and `--verify` reruns the builder's invariant check.
Never reuse a trace output directory. The script shuts down its recorded
server and busy children on success, failure, SIGINT or SIGTERM.

macOS execution is reserved for the operator. The scheduling, worker and trace
modules, including QoS readback tests, passed `cargo check --tests --target
aarch64-apple-darwin` in a small dependency harness on Linux. This checks the
Darwin API bindings, not runtime QoS behavior or the Mac performance target.

## Qualification

Affected server tests: **220 passed, 0 failed, 4 pre-existing ignored** with
4,096 descriptors. The structural test passes on the candidate and fails on
the base with 1,000 serving-thread identities; no wall-clock latency assertion
was added. Saturation, refusal, failed-spawn, adoption, token authority and
panic-recovery cases pass. Whole guide: **110 passed, 0 failed**. Affected
KA/transport: **35 passed, 0 failed**. Reference check: **0 errors, 0 unchecked**.

Wasm: **2,015,329 bytes raw / 605,001 bytes gzip**, under the unchanged
**605,225-byte** ratchet (224 bytes remaining). The raw size matches the incoming merged tree’s record; this host’s gzip
is 276 bytes above its recorded 604,725 bytes and remains within the ratchet.
No wasm-executed code changed and no budget raise was necessary.

The single full `scripts/test.sh` invocation ended **`== 1 failure(s) in 1547 s`**,
listing `cargo test`. It found one introduced fixture compile failure: the standalone
`abort_profile_reports_an_off_thread_panic_to_redirected_stderr` probe omitted
its scheduling dependency. After correcting that isolated test harness, all
**22 lifecycle tests pass**, including the real abort/signal record. The
full suite was not rerun. Client tests passed 5,742, failed zero and skipped ten;
the separately scheduled client models passed all 79. All other suite steps
passed. The recorded elapsed time exceeds the repository’s 60-second suite
budget; this cold/shared-host run is not a suite-budget qualification. [FAILURES.md](./FAILURES.md) lists every failed development
invocation and its classification; logs retain the full errors.

## Round 1 — Astra and Grok review follow-up (2026-10-02)

**The Darwin intake and executed-child QoS defects are corrected. The idle
performance target remains unmet.** Retain the round-0 request pools; running
short requests on their connection parsers did not win on both idle and loaded
axes. No affinity, governor, real-time priority or utilization-clamp change is
shipped. Both round-0 reviews remain historical NOT READY reviews; no round-1
external review is claimed. Nothing is pushed or published.

### Intake, executed children and failures

Before opening the listener, the Darwin creator establishes user-initiated
QoS. The serve loop, accept thread, parsers and request workers use that class;
none is deliberately set to utility. If the setter fails, a readback must prove
default-or-higher inheritance or startup refuses before opening the listener.
Failures are logged, counted and exposed by the live dev host to `doctor`,
which reports the count and last errno as a scheduling problem. The Mac tests
cover intake/request inheritance and an injected failed raise from utility
versus default. Linux never nices the request creator.

The watchdog now launches Node through `posix_spawnp` on Darwin with
`posix_spawnattr_set_qos_class_np(QOS_CLASS_UTILITY)`, a fresh process group,
explicit stdio actions and close-on-exec-by-default descriptors. The watchdog
retains the ownership flock; Node does not inherit it. Linux retains the
ordinary spawn and its inherited nice 5. The design follows Apple's
[spawn QoS clamp implementation](https://github.com/apple-oss-distributions/libpthread/blob/main/src/qos.c).
The readback loads a Rust N-API probe **inside the executed Node**, after its
V8, libuv and two JavaScript workers exist, enumerates Mach threads and checks
all effective base priorities against utility's priority 20. An ordinary Node
exec is the negative control. Requested pthread QoS alone cannot establish a
task clamp, so that is not used as the child oracle.

The scheduling, spawn, request-pool and trace modules, their Mac tests and the
standalone Node addon compile-check for `aarch64-apple-darwin`. This is not a
Mac runtime or performance qualification. Run the operator commands below.

Worker exits now decrement live/idle accounting even outside the request
`catch_unwind`. A caught panic payload whose destructor panics exercises this
case. If the last worker dies with queued requests, their existing guards
refuse them and release their permits; later submissions can replace the
worker. Production still aborts on panic.

Development clock advancement intentionally runs its synchronous jobs and
maintenance at request QoS: it is completion the developer is awaiting.
Ordinary effect leases have no heartbeat; only explicit clock advancement
extends them. The guide and LLP 3000 §7 now say so.

### Pool versus connection-parser execution

[READS.md](./round1/READS.md) contains every endpoint/load comparison. Each
series is pool/inline/inline/pool, five 23-call cohorts per cell, with the
first three retained but excluded from each cohort's ranks. Both traced and
untraced matrices cover 0/48/96/144 busy processes on 96 available CPUs; a
second pair covers 0/5/10/15 on CPUs 0–9. Percentiles below pool 200 retained
samples per design/cell; the per-cohort ranks remain in each summary.

| Untraced, 96 CPUs | Pool p50 / p95 ms | Inline p50 / p95 ms |
|---|---:|---:|
| Idle following-500 | 4.335 / 5.878 | 5.070 / 5.726 |
| Idle following-5 | 4.097 / 5.702 | 4.396 / 5.714 |
| Idle search | 3.513 / 5.821 | 5.488 / 7.464 |
| 96 busy, following-500 | 3.119 / 8.783 | 3.004 / 9.633 |
| 96 busy, following-5 | 2.985 / 8.001 | 2.975 / 8.295 |
| 96 busy, search | 4.240 / 9.810 | 4.039 / 9.992 |

The traced whole-host series favors inline more strongly under contention;
for example search at 96 busy processes is 5.113/11.101 pooled versus
4.155/6.891 inline. The untraced series does not reproduce that tail win.
Ten-CPU untraced idle following-500 improves 5.127→4.298 ms, but search
regresses 3.360→3.695 ms and Insights 1.156→1.211 ms. At ten-CPU full load,
several inline tails regress. These results do not support choosing inline
or an endpoint-dependent hybrid as a general idle fix. The host remains
shared; no exclusive-host or fixed-frequency qualification is claimed.

The preserved [inline experiment patch](./round1/inline-experiment.patch)
can be applied to this round's final tree. It executes only admitted short
requests on their own parser, never on the central dispatcher. The original
32-short permit, refusal bytes/counters, unwind boundary and absolute
body/write deadlines still own execution. The parser already waits for each
response, so the patch adds no connection concurrency. Its scoped Darwin
QoS guard raises a default caller and restores it on unwind; normal intake
is already user-initiated. A 1,000-request keep-alive witness confirms one
parser thread, and the admission/panic tests exercise the alternative.
A test caught a missing refusal-latency sample in the first experiment; the
preserved patch creates that sample before admission, matching the pool.

[CPU.md](./round1/CPU.md) retains CPU identities, per-thread kernel migration
counts and handler CPU time. At ten-CPU idle, following-500 query wall time is
2.109 ms pooled versus 2.935 ms inline, while handler CPU time is
2.929 versus 4.005 ms. Neither design changed CPU during any of those 200
query spans. Across the two complete idle cells, serving-thread migrations
fall from 31 pooled to 7 inline. Fewer migrations did not remove the running-
time increase. The host uses `schedutil`; a later frequency snapshot is
retained but is not per-query frequency evidence. Hardware-cycle collection
was attempted directly and denied with errno 13 at `perf_event_paranoid=4`;
`perf` is also absent. No cycle count is inferred from CPU time or wall time.
The exact frequency/cache cause therefore remains unqualified. **The operator
must decide whether the loaded improvement justifies the idle cost; this round
does not label that trade-off as resolved.**

All 58,880 sampled answers agree across designs and loads within each ABBA
matrix. Seven endpoints also agree across all matrices. Insights' seven
`day(now)` buckets changed across UTC midnight between the whole-host and
ten-CPU series. A separate [-1d/current-day control](./round1/insights-day-control.json)
reproduces the two exact hashes on the same binary/store. No additional answer
field was excluded to obtain equality.

### Mixed-load qualification

`node scripts/contended-reads.mjs --mixed` uses a separate real-clock fixture,
without replay. One-minute scheduled jobs run alongside continuous reads,
four expiring writes/effects per second, a supervised Node worker, intentional
first-attempt retries and deadline failures, and the ordinary maintenance loop.
Read-only SQLite observation records physical deletion, durable job timestamps,
backlog and effect states. Job runtime below is creation-to-completion at
millisecond resolution, including queue time; reclamation/requeue delay has
about 50 ms polling uncertainty plus observer scheduling. These are measured
observations, not new product deadlines.

A two-second abandoned claim pauses **all** worker HTTP traffic for eight
seconds, so claim/settlement sweeps cannot mask maintenance-only recovery.
The harness verifies that no worker HTTP interval overlaps each observed
expiry-to-requeue interval. Each cell separately checks one exact 1,000 ms
lease extension before its real-clock observation window; no clock advance
is used to manufacture scheduled firings or reclamation during the window.
Every expected minute boundary is checked for exactly one completed run;
normal deliveries must be sent, the intentional slow effect must fail with
E_EFFECT_DEADLINE, and every observed expiry and abandoned lease must clear.

The demoted comparison raised idle maximum maintenance-only lease recovery
from 4.659 to 4.872 seconds. Sweep phase affects that maximum, so it does not
isolate a nice-policy cause. The candidate nevertheless restores maintenance
to ordinary priority (inherited on Linux, default on Darwin), covering jobs,
schedules, expiry and lease recovery together. Worker processes retain their
specified nice/QoS policy. Both the demoted observations and the restored
candidate qualification are retained; no unfavorable cell is discarded.

[MIXED.md](./round1/MIXED.md) lists every observed schedule firing delay and
run time for the before-CT, demoted and restored candidates. At each of
0/48/96/144 busy processes, all three designs completed the expected minute
boundaries exactly once, delivered 507 normal/probe effects, recorded the one
intentional E_EFFECT_DEADLINE, and completed 106 retries (100 injected failures
plus six abandoned leases). Maximum backlog was 34 throughout; each explicit
clock extension was exactly 1,000 ms, with no unexpected lease changes during
observation. All expired rows were physically reclaimed.

| Busy | Before lease recovery max, ms | Demoted | Restored | Before expiry max, ms | Demoted | Restored |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 4659 | 4872 | 5227 | 1110 | 1070 | 1094 |
| 48 | 3967 | 3683 | 4307 | 1082 | 1084 | 1130 |
| 96 | 4722 | 4883 | 5169 | 1087 | 1126 | 1136 |
| 144 | 5066 | 4931 | 4575 | 1098 | 1121 | 1113 |

Restored schedule firing delays range from 22 to 1,054 ms; observed job elapsed
time is 0–4 ms. Restoring priority does not make every measured maximum lower:
lease recovery still reaches 5.227 seconds idle, and expiry reaches 1.136
seconds at full contention. These observations retain phase and scheduler
variation rather than asserting timing equivalence from twelve short cells.
The documented schedule/lease/deadline/expiry outcomes passed, and the suspect
maintenance demotion is removed. Exploratory builds/tests overlapped parts of
the before/demoted runs; this is not an isolated causal estimate of nice 5.
A later process snapshot confirmed another lane's Rust suite overlapped the
restored comparison; this lane's own full suite starts after all owned load
stops. No other lane was stopped. The Node policy remains subject to the Mac
mixed-load qualification.

Inspection caught a qualification gap in those first matrices: the slow effect
was emitted together with the lease-extension probe, before the clock advance.
That advance could trigger its deadline, so those twelve deliberate failures
are **not** isolated real-clock deadline evidence. Normal deliveries still met
their real deadlines throughout observation. The corrected mixed harness emits
the slow effect after advancement, while reads are active. Its earlier source
is retained in `round1/inputs/contended-mixed-before-deadline-fix.mjs.txt`.

The added `--mixed --deadline-only` control passes at every load on all three
binaries: every supervised worker claims the effect before its one-second
deadline, concurrent reads succeed, and the effect reaches E_EFFECT_DEADLINE
without any clock advance. Each cell is one probe; the following are observed
failure delays after the deadline, not distribution estimates, with about
25 ms polling uncertainty plus observer scheduling.

| Busy | Before delay, ms | Demoted | Restored |
|---:|---:|---:|---:|
| 0 | 418 | 329 | 328 |
| 48 | 335 | 409 | 308 |
| 96 | 423 | 330 | 343 |
| 144 | 337 | 341 | 69 |

Raw claim/deadline/failure timestamps and read counts are retained under
`round1/deadline-{before,demoted,restored}/`. Corrected complete-mode smoke:
65 seconds idle passed: 264 delivered effects, one intentional deadline failure,
55 retries, three maintenance-only lease recoveries, one completed schedule
boundary, exact 1,000 ms lease extension and every expired row reclaimed.

A final untraced matrix on the exact restored production binary retains another
3,680 samples. Idle following-500/following-5/search p50s are
3.802/3.790/3.221 ms; at 96 busy they are 3.325/2.931/6.312 ms. This is a
post-change control, not a replacement ABBA comparison or an idle-target claim.
Its answers match the ten-CPU matrices' current-day hashes.

### Tests, size and operator commands

The one full `scripts/test.sh` invocation ended **`== 0 failure(s) in 1411 s`**
(exit 0). All stages passed: build, wasm, docs budget, release guard, package and
app checks, Rust, fixture wrappers, client tests and the full seeded models.
The client pool reported 5,742 passed / 0 failed / 10 conditional skips; the
separate model phase reported 79 passed / 0 failed. This shared-host duration
is not a qualification of the script's 60-second budget.

| Check | Result |
|---|---|
| Final serving binary in full suite | 222 passed, 0 failed, 4 pre-existing ignored |
| Final lifecycle in full suite | 23 passed, 0 failed |
| Complete guide, also run separately | 110 passed, 0 failed |
| Unloaded focused latency recheck | 1 passed, 0 failed |
| KA/transport, seven files separately | 61 passed, 0 failed |
| Corrected inline alternative latency cases | 28 passed, 0 failed, 2 ignored |
| Darwin serving modules/tests and Node addon metadata | aarch64-apple-darwin checks pass; runtime awaits Mac |
| LLP reference check | 0 errors, 0 unchecked |

Wasm measures **2,015,329 B raw / 605,001 B gzip**, unchanged from round 0.
The **605,225 B** ratchet remains unchanged, with **224 B** headroom on this
host. No increase is needed, so the conditional request for about 500 B of
headroom on an increased cap does not apply.

The [failure ledger](./round1/FAILURES.md) names every failed development or
qualification invocation, its classification and disposition. The full suite
is run once; a later focused repair/recheck is reported separately.

From `snapback4/`, on a Mac with Node 24 and the pinned dependencies:

```sh
cargo test -p snapback4 --bin snapback4 thread_priority::tests -- --nocapture
cargo test -p snapback4 --bin snapback4 executed_node_and_its_threads_have_utility_task_priority -- --nocapture
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production
node scripts/contended-reads.mjs --prepare --work /tmp/ct-store --binary target/production/snapback4 --out /tmp/ct-prepare
node scripts/contended-reads.mjs --work /tmp/ct-store --binary target/production/snapback4 --out /tmp/ct-pool
node scripts/contended-reads.mjs --mixed --binary target/production/snapback4 --out /tmp/ct-mixed-pool
node scripts/contended-reads.mjs --mixed --deadline-only --binary target/production/snapback4 --out /tmp/ct-deadlines
```

Preserve the pool binary, apply `round1/inline-experiment.patch` from the repo
root, rebuild, and run pool/inline/inline/pool with fresh `--out` directories,
then repeat with `--no-trace`. Preparation is done only once. The same mixed
mode is runnable on macOS; the native Node QoS readback runs independently.
Linux target-check inputs and exact logs are retained under `round1/inputs/`
and `round1/qualification/`. No test or benchmark ran on a Mac in this round.
