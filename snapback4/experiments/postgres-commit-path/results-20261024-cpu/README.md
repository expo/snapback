# CPU lane — S1 increment on the G2/G3 serving path

Base `b3c4aa2bba`, branch `sb4-pg/cpu`, expo-build-450b
(`expose-builder-pixel-a`), 2026-10-24. This is a local CPU and closed-loop
diagnostic, not a matched S1 offered-load qualification or publication claim.
The governing ledger is [the controls RFC §3.4](../../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#34-size-the-whole-cycle-with-measured-tail-cost).

## Result and changes

The **100 µs/member serial CPU target remains unmet**. Repeated instrumented
serving trials measure writer CPU **380.9 → 363.7 µs/member**
(4.5% lower medians).
The separate, uninstrumented solo `Engine::mutate` arm measures
**597.16 → 514.43 µs/mutation calling-thread CPU**
(13.9% lower medians). Its scope matches the M-suite's
561.79 µs solo proxy more closely than the serving writer metric; the old
number is context, not this lane's before measurement. The solo arm retains
N=1 transport/tail work and is not a pure IR-interpreter budget. The grouped
serving arm includes fresh authority/follow-up and amortizes its fixed
transaction/tail costs; these scoped CPU numbers cannot be substituted for
one another in E×N without a composed cycle ledger.

The cuts are deliberately confined to Rust allocation work:

- Stream each SQL command, array and cast into one output String, replacing
  per-parameter/per-element strings, their Vec, joins and formatting buffers.
- Borrow TEXT/BYTEA from the driver's checked binary parameter buffer before
  hex rendering, avoiding the intermediate owned Datum payload.
- Borrow the mutation's immutable Program instead of cloning its whole IR.

Checked ToSql encoding, supported types, NUL/size refusals, cast spelling,
hex/UTF8 conversion, floating-point handling and command guards remain intact.
There is no authority cache, metering change, receipt/evidence change,
physical-read cache, flight change, durability change or public wire change.
Golden-byte and invalid-UTF8/oversize refusal-order regressions complement
the existing Bind/literal differential.

The throughput observations below **do not establish a throughput win**:
N=1 falls slightly and N≤32 rises slightly, with overlapping ranges and shared
host noise. The remaining writer work is led by database calls, interpreter
execution/authorization and per-member orchestration. Driver CPU alone is about 122 µs/member,
above the whole 100 µs budget on this unchanged physical schedule.
The next material lever
is the RFC's bounded read/overlay composition: it must preserve fresh authority,
logical meters, member/savepoint history and durable publication. Allocation
cuts alone have not reached the 3,200/s rung or the 100 µs CPU target.

## Fixture, transport and measurement

The unchanged full S1 schema and `increment` body come from
`experiments/scale-controls/snapback-app/snapback/schema.q`. A native Engine
seed makes one room, 32 users and 32 disjoint owner counters; native `account`
sessions supply all HTTP bearers. Messages are empty. This is the W4 owner
branch, not the 1M-message capacity seed or shared-counter/mixed W5.
Each writer retains its account/counter and waits for its response before the
next request. The generator is Python 3.12.3 HTTPConnection with 32 threads
and persistent loopback HTTP connections. Requests contain only `args` and
an ordinary bearer, with no client operation/store id.

Private PostgreSQL **16.15**, master **114012**, port **55441**, has fsync,
synchronous_commit and full_page_writes on, JIT off, 1 GiB shared buffers and
320 connections. The serving path uses the public CLI's admitted Unix socket
(`/tmp/sb4-cpu/.s.PGSQL.55441`); HTTP is TCP loopback on 55442. The public CLI
at this base refuses database TCP under `connection-tls`. The separate solo
CPU arm uses direct **127.0.0.1:55441 TCP**. No transport admission was relaxed.
These are not the M-suite's delayed links or its 8 GiB PG configuration.

Rust **1.97.0**, release optimization, `debug = "line-tables-only"` through
`CARGO_PROFILE_RELEASE_DEBUG`, `-j 10`, the commissioned
`CARGO_TARGET_DIR=$HOME/projects/sb4-s1sk/snapback4/target`. No RUSTFLAGS or
frame-pointer override was needed for the userspace unwinder. No profile
setting is committed. A measurement-only queue constructor override selects
Fixed(1)/Fixed(32); it is absent from the final source. N=32 is a **cap**:
the unchanged drain policy does not wait for an empty mailbox to fill.
The observed mean effective group is about 16, consistent with the RFC's
finite-population alternation risk; it is not an assertion of 32 every batch.

Primary rate trials use 2 s warmup and 6 s timed work, three repetitions per
arm/N, counterbalanced before/after/after/before/before/after. Entry waits for
one one-second /proc observation with aggregate known compiler/browser
activity below 0.5 core. Continuous sanitized /proc/load samples remain in
`/tmp/sb4-cpu/host.jsonl`; this guard does not reserve the host or prove idle
storage. Every primary trial is retained. Images advance exactly one per
successful writer response; durable counter sums and head advances both equal
the acknowledged count in every primary window. Primary errors: zero.

## Profile, CPU and waiting

`perf record -g` was attempted and denied by `perf_event_paranoid=4`;
passwordless sudo is unavailable. **No perf data or perf-derived claim is
present.** GNU gprofng userspace clock sampling at 1 ms supplies native call
trees and flamegraphs. Temporary nested RAII spans use
CLOCK_THREAD_CPUTIME_ID and CLOCK_MONOTONIC; the final source has no spans,
unsafe clock code, profiling thread, environment selector or new endpoint.
The synchronous postgres 0.19.14 driver polls its connection in the calling
thread's current-thread Tokio runtime; that CPU is counted inside database
calls, not assigned to an invented separate driver thread.

The table uses **medians of three 6 s serving windows per arm**, separately
from the sampled flamegraph runs. CPU is µs per acknowledged mutation.
Nested CPU is subtracted from each stage; stage medians need not sum exactly
to the median of the total. Instrumentation overhead is not subtracted.
HTTP body/operation parsing starts after tiny_http's header parser; the
process remainder includes that parser, accept/dispatch, the profiling output
thread and background work.

| CPU stage | Before µs | After µs |
|---|---:|---:|
| Writer orchestration, attempt setup and follow-up | 59.5 | 52.7 |
| Private invocation binding | 3.3 | 3.4 |
| Fresh authority resolver, excluding calls below | 15.0 | 14.7 |
| Static/argument validation | 12.0 | 12.4 |
| Program execution, row/rule/meter work, excluding calls below | 115.7 | 114.0 |
| Commit/evidence/effect recording | 4.0 | 4.0 |
| Footprint normalization and preservation | 7.1 | 7.2 |
| Tail assembly, excluding calls below | 5.8 | 5.9 |
| Postgres calls: driver, protocol and syscalls | 121.6 | 122.1 |
| Checked parameter/literal encoding | 28.3 | 19.1 |
| Prepared-statement cache access | 8.3 | 8.2 |
| **Total serial writer CPU** | **380.9** | **363.7** |
| Caller: HTTP operation parsing/admission/queue bookkeeping | 57.4 | 54.9 |
| Caller: HTTP ingress authority | 56.4 | 54.1 |
| Caller: Response normalization, encoding and writing | 79.0 | 72.9 |
| **Total request calling-thread CPU** | **192.8** | **181.6** |
| Remaining process CPU: parser/dispatch/background | 104.5 | 97.3 |

Writer wall time/member is 1123.2 → 1097.8 µs;
off-CPU time by subtraction is about
742.4 → 734.1 µs/member.
That combines SQL/network/flush and scheduling waits; it is not a pure
PostgreSQL execution measurement. Request-thread wall time is about
31.60 → 31.38 ms,
predominantly waiting for the writer/response. The clean rate trials below
contain no sampler or stage clocks.

The single sampled N≤32 pair showed 568.4 → 507.0 µs writer CPU and
44.8 → 27.9 µs literal CPU. The repeated table above is the reported summary,
not the larger reduction from that one pair. The initial exploratory sample
overlapped compilation and is retained without being a capacity result.

Raw sampled profiles, archived sources, full call trees and generated SVGs:
`/tmp/sb4-cpu/before-n32.er`, `after-n32.er`,
`before-n32.calltree.txt`, `after-n32.calltree.txt`,
`before-n32.flame.svg`, `after-n32.flame.svg`. They are intentionally outside Git.

## Clean repeated rate and solo CPU results

| N cap | Arm | Writes/s, each run | Median /s | p99 ms, each run | Timed acknowledgements |
|---|---|---|---:|---|---:|
| 1 | before | 224.8 / 225.9 / 230.4 | 225.9 | 248.07 / 191.28 / 146.45 | 4,189 |
| 1 | after | 222.8 / 212.3 / 220.2 | 220.2 | 232.84 / 305.78 / 199.42 | 4,025 |
| 32 | before | 872.1 / 880.2 / 947.1 | 880.2 | 45.44 / 44.25 / 44.33 | 16,285 |
| 32 | after | 890.1 / 913.3 / 897.7 | 897.7 | 43.12 / 52.56 / 42.69 | 16,283 |

N=1 misses the 100 ms write SLO. Closed-loop throughput with no scheduled
arrival process does not establish an offered-rate/error/SLO passing cell.

| Solo CPU arm | µs/mutation, each run | Median |
|---|---|---:|
| before | 597.16 / 606.33 / 536.20 | 597.16 |
| after | 514.43 / 531.09 / 503.47 | 514.43 |

Each solo trial warms 100 and times 1,000 mutations with the calling thread's
CPU clock. It uses the seeded account's Context directly and excludes
credential resolution, initial setup and PostgreSQL/off-CPU waits. The HTTP
arm performs the actual native bearer checks; the core proxy is not itself
an authority or serving qualification.
It includes caller-side driver work and Context cloning. The core arm excludes
HTTP and publication response work, so it must not be added again to a whole
serving CPU or wall cycle. Counterbalanced order is recorded in the raw files.

Earlier sequential clean pilots are retained, not silently replaced:

- before writes/s, caps in order 1/32/32/1/1/32: 238.3 / 916.8 / 855.8 / 220.0 / 210.6 / 901.6; solo CPU 666.93 / 606.17 / 557.26 µs.

- after writes/s, caps in order 1/32/32/1/1/32: 198.9 / 645.1 / 900.8 / 223.1 / 222.4 / 890.5; solo CPU 513.24 / 481.01 / 492.76 µs.

One earlier baseline N=1 pilot returned one 503 E_RATE_LIMIT. The original
sequential after pilots overlapped noisier shared-host conditions. All original
window/image records and failures remain in `/tmp/sb4-cpu/`; the primary
counterbalanced trial design was selected before those primary runs. One
immediate server restart encountered the ordinary unexpired owner lease;
subsequent launches wait for the original lease to expire. No lease or timeout
setting was changed to hide that setup refusal.

## Verification and custody

No raw logs, tokens, database files or large profiles are committed. The only
source changes are the literal encoder, borrowing the Program and the two
codec regressions. Final-source checks and process custody are recorded below.

The full core run passes **733 unit tests**, with 279 existing named ignores,
all **45 integration targets** and **38 doctests**. The full binary passes
**577 tests**, with 45 existing named ignores; both RT0 ratchets pass
(five cases). These full runs precede the final invalid-UTF8/oversize
refusal-order refinement. The subsequent **21-case codec scope passes on
the final encoder**, including both new regressions. That refinement affects
invalid custom ToSql text only, absent from the measured valid S1 workload;
the archived after measurement binaries predate it.

The complete `bash scripts/test-postgres.sh` runs every stage and exits **1**.
Its five failing scopes are retained:

1. The evaluator's unchanged Serializable increment stress case returns
   SQLSTATE `40001` at `conformance.rs:294` (parent join :307): 21 passes,
   one failure, three existing filters. Recorded in the
   [existing evaluator ticket](../../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
2. The ownership lost-commit-ack witness rejects the supplied TCP URL under
   its Unix-socket-only transport guard: 24 passes, one setup failure.
3. The startup-renewal witness rejects that same TCP test URL. Both transport
   setup errors belong to this lane's check invocation, not to an established
   product regression. Corrected socket reruns are reported below.
4. The differential-library snapshot worker exceeds its unchanged 60-second
   `ready` setup guard: ten passes, one failure. Worker 434634 is killed and
   reaped; no oracle mismatch is reported. The exact isolated test passes in
   1.01 seconds on the corrected socket URL, with worker 491897 reaped.
   This is a changed setup, not a retroactive full-run pass; the
   [new setup ticket](../../../../issues/20261024-snapback4-difftest-snapshot-worker-setup-deadline.md)
   preserves the red.
5. The public CLI witness exceeds its unchanged **45-second deploy guard**
   at the main `deployment` fixture. Its owned cluster is stopped and
   confirmed. This occurrence is recorded in the
   [existing public deploy ticket](../../../../issues/20261023-snapback4-public-postgres-deploy-45-second-guard.md).

Successful Postgres-script scopes include **232 adapter**, **13 evidence**,
**21 codec**, **60 evolution**, **17 program-group/oracle**, **six outcome and
deadline**, **15 command**, **62 HTTP authority-boundary**, **22 supported
corpus** and **four store-campaign** tests, plus the committer, device,
key-limit, evaluator-oracle and maintained-member scopes. Public EV-1 and
EV-2 restoration/wire witnesses and both-store P1-CE complete before the
later timeout; EV-2 compares **1,538,672 bytes** of wire and meters identically.
No retry budget, timeout, workload, durability setting or existing filter is
relaxed to obtain these results.

The corrected Unix-socket reruns pass **all 25 ownership tests** and the
startup-renewal cleanup witness. Final-source full binary and both RT0 runs
also pass: **577 passed / 45 existing ignores**, and **five ratchet cases**.
The standalone public stage remains **red**: its first main deploy completes
in 44.579 s, but the following EV-1 Postgres deploy reaches the original
45 s guard before any observed bootstrap checkpoint. Its cluster is stopped
and confirmed. Optional harness observations remain outside Git in
`/tmp/sb4-cpu/public-final-timings.jsonl`; no causal load attribution or green
whole-script/public-stage claim is made.

The normal debug build and final release build pass (`-j 10`, locked
dependencies; final release retains line tables). Final `./ref-check` passes
with the journal/ticket updates: **567 LLP documents, 11,840 refs, zero errors
and zero unchecked references**. Whitespace validation passes.

Owned postmasters **114012**, **441562** and **491988** are stopped. An
independent final audit checks **4,270 distinct recorded PIDs**: all absent,
with no matching leftover process. Each cluster returns `pg_ctl status` 3,
with no postmaster pidfile or Unix socket; measurement ports 55441/55442
have no listener. The disk and host observers are also stopped and reaped.
**PIDs left: none.** Minimum observed `/home` free space is **42.43 GiB**;
final audit free space is **74.29 GiB**, above the 30 GB stop condition.

Only this lane's two stopped public fixture trees are relocated from
`/tmp/s10d3-serve-{g46dl8pq,yctowf0w}` to
`/tmp/sb4-cpu/public-witness/` with the same basenames. Original log paths
refer to their pre-relocation locations. The independent audit and mapping
are in `/tmp/sb4-cpu/cleanup.json`. Raw evidence stays under `/tmp/sb4-cpu/`.
No push, stash, Git configuration change or operation on another cluster
occurs; pre-existing untracked `target-b1/` and `target-pre/` are preserved.

Binary SHA-256 receipts (measurement-only policy selector; no clock/sampler):

- `snapback4-baseline-clean`: `117bc5156af6ce43af53009beda374cdfcce03e5083c08cee35ba6b74c899d39`
- `snapback4-after-clean`: `7a8fc39057807dcf74ba1c82056a877df3db335070b5836938d178e3a9ba160c`
- `solo-baseline-clean`: `b94fe436dfbb2795e27a8afa83da59994e879cc76138eb13f470d24a79f0560f`
- `solo-after-clean`: `7c163f68c9555f853dc0e322f45f786827174f97a4725730c2e70ab36b5db579`
