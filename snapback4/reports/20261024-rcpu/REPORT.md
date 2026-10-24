# RCPU: release read CPU and concurrency on private Postgres

Local lane `sb4-pg/rcpu`, required PIPE base `c7a0a597ee22d8626879597dad04d071b8d0d7da`
on main `480f88e8b4`. Nothing is pushed or published.

At 128 pooled clients, release W1 improves **5,113 → 17,847 reads/s**,
W2 **4,756 → 10,872**, and W3 **2,532 → 5,415**. All nine final windows
have **zero errors**. Warm W1/W2/W3 still uses one PG flight each; every
request resolves fresh authority and row facts from the same statement cut.

**The W2/W3 campaign targets remain unmet.** This lane is loopback capacity
evidence, not S1 open-loop/SLO qualification on the campaign links. The measured
W2 server CPU is within the commissioned 0.3–0.5 ms range, but PG plus client
CPU leaves insufficient one-host capacity for 16k/s. W3's ordinary Rust
interpreter, physical decoder and PG fanout remain expensive. No G5 result
cache, authority grant or cross-request row/allow cache is added.

## Method and custody

expo-build-450a (OS hostname expose-builder-nothing; its local Tailscale address
matches the commissioned host), Ryzen 5 3600, 6 physical cores / 12 threads,
Rust 1.97.0. Every Cargo invocation uses eight jobs and the owned target
`$HOME/projects/sb4-s10a/snapback4/target`. Throughput uses **release only**:
`cargo build --release --locked -j 8 -p snapback4`, with
`CARGO_PROFILE_RELEASE_DEBUG=line-tables-only`. Dev/test symbols also use
line-tables-only. The S1 harness is separately built with `--release`.

The unchanged S1 Quarry app and native `Engine::seed_at` fixture produce
1,000,000 messages, 8,448 memberships, 1,025 rooms, 256 users and 257 counters.
Maintained fields are assigned by the engine, never SQL. Native seeding takes
1,796.996 s under competing compilation; stock VACUUM (ANALYZE) follows it.
The cluster is private **PG16.15**, port **55461**, master PID **2332629**,
data under `/tmp/sb4-rcpu/data`; max_connections=400, shared_buffers=512 MiB,
normal fsync/synchronous_commit/full_page_writes. HTTP uses loopback TCP
`127.0.0.1:58081`; the database uses its Unix socket because public `serve`
retains its Unix-only Postgres profile. No artificial delay is injected.
The existing PG17 cluster on 55440 is not stopped or reconfigured.

The real S1 client (`experiments/scale-controls/src/load.rs`) uses pooled
keep-alive reqwest, closed-loop 64/128/256 clients, one outstanding operation
per client, 1 s warm-up and common 5 s measured windows. It retains S1's
operation selection, response normalization and validation. Closed-loop is an
explicit diagnostic mode; ordinary open-loop scheduling/SLO accounting is
unchanged. Simultaneous `--closed-loop` and `--rate` is rejected.

CPU snapshots share the measured boundaries. Server CPU covers its complete
process, including HTTP/PG I/O/background threads. PG CPU includes its live and
reaped child processes, under the owned cluster root. Client CPU covers the load
process. CPU/read divides by **successful completions inside the window**,
including warm-up arrivals completing there and excluding drain; failed work
still costs CPU. Latency below covers validated successful arrivals. Counters
carry PID start ticks; none of the retained windows has an invalid counter.
Sampling intervals are about 4.99 s, with 10 ms Linux process-counter resolution.

One-minute load is recorded at both measured boundaries, including profiling
and warm-up diagnostics. Before windows at load >2, a two-second process-CPU
census distinguishes decaying owned load from competing work. Other work above
0.5 core waits up to 30 minutes, with every wait recorded. The retained windows'
final censuses report competing work below 0.5 core; high loads in the tables
are therefore usually decaying or current owned work. No own build or test runs
during a measured window. Other work can start during a window; no result is
selected away on performance. The initial token-mode failures occurred before
load generation (the token file needed mode 0600); they are not throughput
windows. One array-only W3 comparison was deferred before it began when
competing work occupied 6–10 cores; final W3 windows use a fresh gated runner.

Uninstrumented executable SHA-256 for final capacity windows:
`66085d48a80038daea56f4e84874c671178ed8bbc3454d085d80c5e0138a822d`.
Temporary clock/profile code, its local absolute paths and its unsafe-code lint
exception are removed before qualification. Raw logs/profiles, tokens, data,
process identities and clock streams stay outside Git under `/tmp/sb4-rcpu`.

## Baseline and final: all commissioned client populations

`before` is the unchanged PIPE product at `c7a0a597ee`, using the new diagnostic
harness. `after-primary` is the final product delta. All values are retained,
without best-of selection. CPU values are microseconds per successful completion.

| Arm | Shape | Clients | Reads/s | p50 / p99 ms | Server / PG / client CPU µs/read | Errors | Load before / after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| before | W1 | 64 | 5,188 | 12.10 / 19.73 | 447.2 / 1657.7 / 84.8 | 0 | 1.43 / 4.36 |
| after-primary | W1 | 64 | 18,590 | 3.33 / 6.59 | 264.4 / 243.8 / 66.3 | 0 | 2.41 / 5.34 |
| before | W1 | 128 | 5,113 | 24.69 / 36.34 | 454.9 / 1660.7 / 88.0 | 76 | 10.73 / 12.43 |
| after-primary | W1 | 128 | 17,847 | 7.01 / 11.92 | 275.3 / 245.8 / 69.0 | 0 | 10.17 / 12.16 |
| before | W1 | 256 | 4,489 | 41.22 / 95.62 | 606.4 / 1651.6 / 229.9 | 16504 | 16.61 / 19.52 |
| after-primary | W1 | 256 | 17,810 | 14.04 / 26.85 | 282.0 / 245.7 / 73.2 | 0 | 14.36 / 16.66 |
| before | W2 | 64 | 4,748 | 13.16 / 22.35 | 609.5 / 1620.9 / 122.6 | 0 | 4.01 / 6.25 |
| after-primary | W2 | 64 | 11,077 | 5.60 / 10.42 | 416.5 / 444.5 / 109.4 | 0 | 4.99 / 7.80 |
| before | W2 | 128 | 4,756 | 26.53 / 40.17 | 615.6 / 1627.8 / 128.7 | 153 | 11.44 / 13.96 |
| after-primary | W2 | 128 | 10,872 | 11.54 / 18.20 | 436.0 / 450.7 / 113.5 | 0 | 11.18 / 13.57 |
| before | W2 | 256 | 4,123 | 43.84 / 89.19 | 781.5 / 1634.7 / 275.0 | 16018 | 17.96 / 24.05 |
| after-primary | W2 | 256 | 10,722 | 23.46 / 44.70 | 438.9 / 457.2 / 115.5 | 0 | 15.32 / 16.90 |
| before | W3 | 64 | 2,661 | 23.54 / 37.19 | 1344.4 / 2909.7 / 120.2 | 0 | 8.88 / 10.73 |
| after-primary | W3 | 64 | 5,542 | 11.28 / 19.50 | 1039.4 / 836.2 / 106.5 | 0 | 7.57 / 10.17 |
| before | W3 | 128 | 2,532 | 49.64 / 72.35 | 1362.0 / 2908.0 / 133.5 | 225 | 15.01 / 16.61 |
| after-primary | W3 | 128 | 5,415 | 23.15 / 36.27 | 1055.3 / 844.0 / 109.7 | 0 | 12.57 / 14.36 |
| before | W3 | 256 | 2,309 | 73.79 / 126.68 | 1630.3 / 2909.7 / 389.8 | 15976 | 22.12 / 25.56 |
| after-primary | W3 | 256 | 5,426 | 46.53 / 77.40 | 1067.8 / 842.2 / 114.3 | 0 | 15.54 / 17.26 |

The old admission population was 30 executing + 98 queued =128. At 128 callers,
a client can observe its completed response and submit its next request before
the previous worker returns its permit; the window contains occasional 503s.
At 256, genuine overload plus refusal/connection churn costs substantial CPU.
The final queue is 258 (288 total), retaining 30 executing workers and the same
intake/body deadlines, independent queue expiry and non-draining refusal. Its
sockets enter connection/descriptor sizing. Default connections become 1,442,
with a 6,280-descriptor reservation; small long-wait configurations retain room
for mutations. Both hard-coded sizing tests retain explicit numerical assertions.

## Causal intermediates

These arms share the fixture, release profile and diagnostic method. They are
capacity diagnostics, not S1 SLO wins; admission errors remain visible.

- `prepared-auto`: bounded code cache, PG automatic plan selection.
- `hot-plan`: borrowed schema, direct Value keys, schema-address constants and
  the bounded online-only scope-metadata fast path; automatic PG plans remain.
- `generic`: additionally reader-only `force_generic_plan`.
- `arrays`: additionally typed fact arrays and planner barriers around repeated
  source JSON/address expressions. Its W3 window never began under competing load.
- `after`: additionally interpreter string/environment reuse, the larger bounded
  HTTP queue and snapshot-local cached accounting of immutable row images.
- `after-primary`: additionally intrinsic byId facts fetch at the row primary
  address, retaining the exact portable `[id,id]` full index key for Rust.

| Arm | Shape | Clients | Reads/s | p50 / p99 ms | Server / PG / client CPU µs/read | Errors | Load before / after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| after | W1 | 64 | 17,280 | 3.55 / 7.46 | 270.1 / 276.7 / 66.1 | 0 | 7.82 / 9.91 |
| after | W2 | 64 | 10,970 | 5.65 / 10.44 | 419.9 / 453.4 / 108.7 | 0 | 9.91 / 13.12 |
| after | W3 | 64 | 5,107 | 12.25 / 20.27 | 1049.1 / 1013.9 / 107.7 | 0 | 12.07 / 13.11 |
| after | W1 | 128 | 17,040 | 7.27 / 13.30 | 281.2 / 275.7 / 69.7 | 0 | 15.42 / 17.47 |
| after | W2 | 128 | 10,677 | 11.72 / 19.68 | 439.6 / 460.0 / 113.7 | 0 | 17.47 / 19.28 |
| after | W3 | 128 | 5,067 | 24.94 / 38.04 | 1061.8 / 1024.3 / 110.9 | 0 | 17.81 / 18.71 |
| after | W1 | 256 | 17,024 | 14.69 / 29.36 | 285.4 / 274.2 / 74.2 | 0 | 19.93 / 21.46 |
| after | W2 | 256 | 10,687 | 23.54 / 46.43 | 441.5 / 460.4 / 114.7 | 0 | 21.46 / 23.02 |
| after | W3 | 256 | 4,985 | 50.79 / 80.74 | 1075.2 / 1022.7 / 115.9 | 0 | 21.18 / 21.89 |
| arrays | W1 | 128 | 17,341 | 7.16 / 13.31 | 274.3 / 272.5 / 69.7 | 37 | 5.28 / 7.74 |
| arrays | W2 | 128 | 10,125 | 12.35 / 21.27 | 432.0 / 456.9 / 112.8 | 52 | 10.32 / 12.38 |
| generic | W1 | 128 | 16,269 | 7.65 / 14.11 | 280.8 / 305.4 / 69.3 | 37 | 5.38 / 7.19 |
| generic | W2 | 128 | 9,952 | 12.57 / 20.79 | 465.6 / 503.8 / 113.5 | 49 | 6.62 / 9.13 |
| generic | W3 | 128 | 3,758 | 33.65 / 45.38 | 1176.8 / 1732.0 / 116.0 | 187 | 11.36 / 12.93 |
| hot-plan | W1 | 128 | 14,189 | 8.61 / 17.58 | 279.9 / 310.5 / 69.6 | 23 | 14.02 / 15.70 |
| hot-plan | W2 | 128 | 3,840 | 28.88 / 59.70 | 530.8 / 1375.1 / 130.2 | 72 | 9.39 / 11.44 |
| hot-plan | W3 | 128 | 3,390 | 37.32 / 53.41 | 1196.3 / 1743.7 / 118.6 | 196 | 11.44 / 12.85 |
| prepared-auto | W1 | 128 | 6,320 | 19.96 / 30.82 | 440.8 / 1245.0 / 86.1 | 119 | 3.63 / 6.54 |
| prepared-auto | W2 | 128 | 5,513 | 22.81 / 35.59 | 602.6 / 1277.4 / 125.9 | 142 | 7.94 / 9.95 |
| prepared-auto | W3 | 128 | 2,923 | 43.32 / 56.98 | 1345.8 / 2514.4 / 128.6 | 253 | 9.95 / 11.63 |

## Server CPU attribution

Separate release clock builds use CLOCK_THREAD_CPUTIME_ID for nested spans,
with the PG connection future's polls timed on their actual I/O thread. Rows
below are **exclusive profiled CPU µs/read**, not a rescaling of uninstrumented
throughput. The 0.5 s cumulative samples lie strictly inside the common measured
window and normalize by completed interpreter calls. Tiny HTTP has its own
stream normalized to the same rate. Clock/allocator sampling adds overhead:
profiled process totals are higher than production totals. The unexplained
residual includes collector/clock/unspanned runtime/accept work; it is retained.

gprofng 2.42's collector yields no usable clock samples here, including after
a timer-zero initialization workaround. No perf permission is changed. The
thread-clock self-check verifies nesting and two independent threads.

| Exclusive CPU area | W1 before → after | W2 before → after | W3 before → after |
| --- | ---: | ---: | ---: |
| HTTP parser (tiny_http) | 29.0 → 25.3 | 29.0 → 26.5 | 38.4 → 26.6 |
| HTTP response/write | 67.8 → 51.9 | 59.8 → 53.9 | 56.5 → 55.0 |
| Routing / arguments / authority hint | 17.2 → 16.2 | 21.2 → 21.0 | 29.6 → 27.1 |
| Fact planning / closure / SQL construction | 77.8 → 38.1 | 72.1 → 35.8 | 78.5 → 49.9 |
| Parameter admission / literal encoding | 12.9 → 7.9 | 12.6 → 8.4 | 11.2 → 4.9 |
| PG caller send/receive | 32.6 → 18.0 | 32.7 → 20.9 | 34.3 → 22.7 |
| PG I/O future polls / wire decoding | 20.3 → 13.5 | 29.3 → 22.0 | 30.7 → 24.8 |
| Physical fact / key / Value decoding | 19.7 → 15.5 | 120.7 → 86.2 | 306.9 → 230.5 |
| Rust interpreter / rules / metering | 43.8 → 37.9 | 94.6 → 81.7 | 636.6 → 568.4 |
| Result JSON encoding | 5.3 → 4.4 | 19.8 → 18.8 | 29.4 → 29.8 |
| Fresh shared authority resolver | 1.3 → 1.2 | 1.3 → 1.3 | 1.4 → 1.3 |
| Shared locks / reader checkout | 22.7 → 25.3 | 23.1 → 25.2 | 23.0 → 24.1 |
| Admission / worker condvar | 5.9 → 4.5 | 5.8 → 5.1 | 6.3 → 5.6 |
| Other host work | 133.1 → 64.2 | 142.8 → 85.4 | 211.3 → 125.5 |
| Unattributed process residual | 45.7 → 30.4 | 47.6 → 34.5 | 53.7 → 42.8 |
| Profiled whole server process | 535.0 → 354.2 | 712.2 → 526.6 | 1547.8 → 1238.7 |

The corresponding one-minute loads at the profiled measured boundaries are:

| Shape | Before-code profile: load before / after | Final-code profile: load before / after |
| --- | ---: | ---: |
| W1 | 24.35 / 25.36 | 6.22 / 9.24 |
| W2 | 23.22 / 23.45 | 9.80 / 10.54 |
| W3 | 19.84 / 22.02 | 8.91 / 11.00 |

Acceptance is separately identified by `inet_csk_accept` in the uninstrumented
per-thread snapshots. Its CPU/read is approximately W1 0.44→0, W2 0→0 and
W3 1.77→0 µs at 128 clients, at 10 ms tick resolution. Parser and response CPU
above are much larger. A native witness holds 30 idle keep-alive sockets while
a new authorized W1 completes: **idle sockets do not hold short workers**.

Allocation CPU remains inside the stage/process totals. Sampling every 256th
alloc/free/realloc estimates about **1,992→1,179**, **3,520→2,547**, and
**12,545→9,153 calls/read** for W1/W2/W3. Paired-clock subtraction is too noisy
for an independent allocation-CPU number; one baseline estimate exceeds total
CPU and is discarded. The separate stack sample identifies interpreter
statements, Value/map cloning, range/key construction and physical row decoding;
it is diagnostic and supplies no throughput claim. No allocator is changed.

The profiled PG caller's wall-minus-thread-CPU time falls from **5.13→1.26 ms**,
**5.47→2.04 ms**, and **9.24→3.72 ms/read**. This includes database execution,
backend/driver queueing and scheduling; it is not a network RTT measurement.
Lock/checkout wall-minus-CPU is about **178→220**, **375→329**, and
**365→518 µs/read**. These waits can overlap and must not be added as CPU.
Worker samples mostly alternate runnable execution and futex waits for PG;
keep-alive parser wall time includes socket/response waiting. The 30-worker
pool remains occupied under saturation; a separate 120-worker arm follows below
to distinguish that population limit from the CPU ceiling.

## What changed and what remains binding

The reader cache retains at most 32 prepared statements per physical connection,
keyed by exact SQL and parameter types, with LRU retirement. Reader sessions
force generic plans, with schema table/index/field addresses safely encoded as
code constants and request keys/digests retained as typed parameters. Writer
and lease plan policy is unchanged. Each Bind/Execute/Sync has its own implicit
transaction and fresh snapshot. Cold preparation adds a counted flight; ordinary
unknown-token ingress retains its one-flight Parse/Bind/Execute/Sync path.
Connection loss never replays an in-flight request; fallback retains exclusive
physical custody and its fresh-cut/revocation rules.

Typed arrays avoid wrapping row JSON in outer JSON and hex-encoding binary
index keys. A failed guard transfers no images; the existing conservative
physical payload/decode bound remains. Planner barriers decode each dependent
source JSON once and form its range once. NUL-containing source images, sparse
defaults, optional addresses and wider/ineligible shapes retain Rust fallback.
Intrinsic byId point facts use `r`'s primary address; byId ranges keep the index
path, and the point preserves its exact `[id,id]` ordered key and logical charges.

Scope metadata avoids serializing the IR for online-only schemas only when
initial sites plus possible unscoped table visits prove the old walk cannot
exhaust; replicated/exhausted cases retain their old path. Schema is borrowed
during closure building. Meter/statement strings and existing environment keys
reuse storage. Immutable fact accounting is memoized **inside the request**;
every logical access still performs the same ordered preflight, guard and entry
charges. It carries no authority and dies with the transaction.

For the same 128-client final windows:

| Shape | Server + PG µs/read | Server / PG / client cores used | Optimistic 12-thread server+PG ceiling | Ceiling including this client |
| --- | ---: | ---: | ---: | ---: |
| W1 | 521.1 | 4.91 / 4.39 / 1.23 | 23,028/s | 20,334/s |
| W2 | 886.7 | 4.74 / 4.90 / 1.23 | 13,533/s | 11,998/s |
| W3 | 1899.2 | 5.71 / 4.57 / 0.59 | 6,318/s | 5,973/s |

These are CPU conservation ceilings, not throughput predictions: this host has
six physical cores with SMT, scheduling and cache contention. W2 already needs
more than the 750 µs combined server+PG budget for 16k/s on twelve fully useful
threads. W3 needs about 1.90 ms, with 64 ordinary logical room point reads per
query plus a 32-row membership page. More HTTP clients do not lower that work.
No conclusion about the campaign's natural or added-0.5 ms link follows from
loopback alone. Only W1 has substantial CPU headroom against its stated target.

## Worker population control

The first post-qualification worker pilot coincided with renewed competing work
(4–8 cores in adjacent censuses). Its completed cells remain below; they are a
confounded diagnostic, not evidence for selecting a worker count. The runner
was interrupted during 120-worker W3, its owned server stopped, and its incomplete
client confirmed/stopped. That interrupted window has no usable CPU comparison.

| Arm | Shape | Clients | Reads/s | p50 / p99 ms | Server / PG / client CPU µs/read | Errors | Load before / after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| workers-30 | W1 | 128 | 12,700 | 9.62 / 19.30 | 278.0 / 259.4 / 70.1 | 0 | 8.63 / 10.26 |
| workers-30 | W2 | 128 | 8,253 | 14.11 / 32.26 | 431.4 / 447.6 / 111.5 | 0 | 9.83 / 12.64 |
| workers-30 | W3 | 128 | 2,675 | 47.25 / 73.27 | 1141.9 / 887.6 / 124.1 | 0 | 12.64 / 15.80 |
| workers-120 | W1 | 128 | 14,002 | 8.55 / 21.25 | 317.7 / 233.7 / 68.7 | 0 | 14.63 / 20.43 |
| workers-120 | W2 | 128 | 9,564 | 12.72 / 28.70 | 481.4 / 416.6 / 107.3 | 0 | 18.95 / 20.56 |

The repeat requires **15 continuous seconds below 0.5 competing user core**
before each startup/window, bounded at 30 minutes. At 250 ms intervals it also
samples global user+nice ticks minus the owned process trees' user ticks,
including reaped child CPU. Samples strictly inside the common measured window
check for bursts after admission. All six retained repeat windows are below
0.5 competing user core (approximately 0.00–0.01 at this counter resolution).
Kernel/network overhead is not assigned by that user-CPU subtraction. Loads
before/after are still retained independently.

Both binaries use the same final product code, 30 physical PG readers plus
writer/lease and PIPE depth 4. The diagnostic build changes only the short-worker
constant from 30 to 120; it is not committed. Samples witness **30 versus 120
actual request threads** and the same 38-process PG family (master/background
plus 32 connections). The source and shipped release executable are restored
to 30 before the final binary check; all six repeat windows have zero errors.

| Arm | Shape | Clients | Reads/s | p50 / p99 ms | Server / PG / client CPU µs/read | Errors | Load before / after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| controlled-30 | W1 | 128 | 17,883 | 6.92 / 13.11 | 271.3 / 249.3 / 68.7 | 0 | 1.94 / 5.31 |
| controlled-30 | W2 | 128 | 11,024 | 11.38 / 17.86 | 429.3 / 444.1 / 112.1 | 0 | 4.13 / 6.52 |
| controlled-30 | W3 | 128 | 5,514 | 22.90 / 32.34 | 1046.4 / 833.8 / 108.4 | 0 | 4.67 / 7.34 |
| controlled-120 | W1 | 128 | 17,915 | 6.80 / 15.17 | 313.3 / 226.6 / 65.3 | 0 | 3.76 / 6.66 |
| controlled-120 | W2 | 128 | 10,807 | 11.17 / 25.99 | 475.1 / 407.5 / 103.6 | 0 | 5.19 / 8.06 |
| controlled-120 | W3 | 128 | 5,573 | 20.51 / 67.90 | 1118.6 / 800.6 / 100.1 | 0 | 5.83 / 12.33 |

Moving to 120 changes W1/W2/W3 throughput by **+0.2%, −2.0%, +1.1%**, with
higher server CPU/read and W3 p99 **32.34→67.90 ms**. It moves waiting into
executing readers/PG pipelines without a useful capacity gain. **Retain 30
executing workers.** Idle sockets do not pin them; their count is not the
remaining useful throughput lever on this CPU-bound loopback workload. The
larger bounded waiting queue independently removes the 128/256-caller admission
churn. Future link qualification still needs its own measurements.

## Qualification and cleanup

| Check | Passed | Failed | Ignored / qualification detail |
| --- | ---: | ---: | --- |
| Release build (`--release`, eight jobs) | 1 build | 0 | Final source restored to 30 workers; no profile module |
| Full default core, 47 top-level targets | 1,138 | 0 | 5 named ignores |
| Full `snapback4` binary | 588 | 0 | 49 named ignores; complete rerun after sizing-assertion repair |
| `bash scripts/test-postgres.sh`, 32 Rust targets | 658 | 1 | Sole failure is the commissioned inherited evaluator `40001` |
| Public deploy/serve witness inside PG script | 1 witness | 0 | Persistence, lease loss, revocation, evolution, SDK changes and maintained totals; owned cluster stop confirmed |
| Both RT0 ratchets plus boundary witnesses | 5 | 0 | Warm PG W1/W2/W3 **1/1/1**, SQLite **5/5/132**; ratchet files byte-unchanged |
| Additional private TCP `TCP_NODELAY` witness | 1 | 0 | Reader and synchronous writer; traced child reaped |
| Reader cache/transport filter inside PG script | 6 | 0 | Unix URL makes its TCP subcase inactive; additional TCP witness above is active |
| Closure filter inside PG script | 12 | 0 | 11 active semantic/fault/cut/decoder witnesses plus inactive manual timing helper |
| S1 client correctness | 4 cases | 0 | Closed W1/W2/W3 and unchanged open W2; counts/validation/pooling; rate conflict rejected |
| Idle keep-alive socket witness | 1 | 0 | 30 held idle sockets, fresh authorized W1 completes |
| Root `./ref-check --verbose` | PASS | 0 | 567 LLP docs, 11,869 refs, 43,652 files; zero unchecked |

Counts are executions per staged command, not unique tests across overlapping
filters. Nested subprocess summaries are excluded. The initial complete binary
run was 586 passed / 2 failed / 49 ignored: its two failures were old explicit
connection/descriptor expectations. Those expectations are corrected to 1,442
connections, 6,280 descriptors (391 connections for the small configuration),
and the full rerun is green. The evaluator red remains a red, not a successful
qualification: `evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
returns PostgreSQL serialization failure `40001`. No other affected test fails.
The public witness passes and confirms its separately owned PG16 cluster stopped.

The affected LLP audit checks the read-trip, connection, control and root
admission notes against the final implementation; their @refs and metadata pass.
This is not publication or campaign promotion. Product commits are
`b95cd5a4d7` (client diagnostics), `841fc23a51` (bounded prepared code),
`dee128cf53` (plans/payload/interpreter/admission), and `f79592c918`
(snapshot-owned accounting / primary facts). Report and qualification records
are delivered locally on `sb4-pg/rcpu`; no push or Git configuration change.

The lowest recorded free space across samples/pruning receipts is **42.28 GiB**;
the 40 GiB floor never triggers. Only obsolete artifacts in the owned target
are reclaimed. No q24 files or shared PG17 configuration/processes are changed.
Only recorded owned process identities are signalled.

Private lane PG16 master **2332629** is stopped with `pg_ctl -m fast -w stop`,
then independently returns **status=3**, with no postmaster.pid and no process.
Public-witness master **2988427** has the same confirmed stopped state. The PID
audit checks **3,465 recorded identities**: **zero remain alive**, including
benchmark servers and clients. Data, receipts and raw evidence remain under
`/tmp/sb4-rcpu`, outside Git. **Owned PIDs left: none.**
