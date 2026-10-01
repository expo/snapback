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
