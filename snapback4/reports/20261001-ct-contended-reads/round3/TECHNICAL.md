# Round-3 design, ordering and measurement limits

The incoming commit is 32e111fff0. Round-2 fixes to request-worker exits,
intake/worker QoS, diagnostics and qualification remain in all three variants.
No request priority, admission limit, reader custody, FIFO engine policy,
lease duration, deadline rule, durability mode or public answer contract changes.

## Classes and ordering

| Ordinary / inherited nice | Utility / nice at least 5 |
|---|---|
| Ephemeral sweep, 100 ms loop | Following delivery, backfill, cleanup and purge |
| Physical row expiry, once per one-second tick | Row-view recounts / durable rebuild chunks |
| Schedule boundary firing, one schedule transaction/admission | Self-chunked jobs, including scheduled jobs after admission |
| Action/effect lease recovery and deadlines, every fifth tick | Other engine catch-up represented by those runners |
| Stale-asset preparation/reclamation, every sixtieth tick | No dedicated compaction runner exists in this host loop |

Atomic storage commit/checkpoint work stays with its caller. No new compaction
algorithm or delivery throughput optimization is included.

The running split binary's Linux thread readback during the 96-process mixed
Following tail confirms nice 0 for `maintenance` and request threads, nice 5 for
`bulk-maintenance` (the kernel truncates its name). See
`qualification/linux-priorities.txt`, captured with
`ps -L -p 2401400 -o pid=,tid=,ni=,comm=` on 2026-10-02 around 04:34 UTC.
This is Linux evidence; Darwin calls retain the already-qualified helpers but
have no new round-3 runtime readback.

The low-priority thread cycles one delivery, one recount, one job slice. Both
maintenance threads share a FIFO coordination gate; it releases between slices,
so a waiting ordinary slice or clock advance precedes the next bulk slice.
The gate is distinct from actual engine ownership for latency accounting.
Every engine admission still uses the existing FIFO and cooperative 250 µs
contended / 2 ms quiet budgets. A schedule slice is one atomic boundary/admission
transaction. Asset file removal holds no engine guard; atomic filesystem and
commit operations can exceed the cooperative budget.
The recount runner retains its fixed metered atomic chunk; it accepts but does
not subdivide that chunk by the duration argument. Native job chunks likewise
retain their existing atomic metering. The host does not preempt either unit.

Delivery commits before recount within a bulk cycle. Recounts consume committed
engine state and their existing durable cursor/basis/delta rules handle later
writes; they never require the entire delivery queue to empty first. This is
compatible with the previous 500-chunk delivery phase, which also could leave
pending delivery. New work from jobs can enter the next cycle. Timing-critical
sweeps can interleave between any pair of these committed slices.

Development clock advancement holds the coordination gate through its existing
synchronous full drain (delivery, recount, expiry/schedules, jobs, lease/asset
sweeps), extends held leases atomically with advancing the clock, and retains
request QoS. It remains an explicit developer operation, not background work.

## Progress bound

The shared cursor records the completion of every bulk turn, including empty or
failed turns. If no turn completes for one second, the next ordinary age check
runs the next bulk slice itself. Checks happen after every ordinary engine
slice and on the 100 ms loop. This makes progress independent of whether the
utility/nice-5 thread gets CPU. No attempt is made to restore Linux nice without
privilege, and no utility thread must raise its own Darwin QoS.

Each three turns visit delivery, recount and jobs once. With the lower-priority
thread unscheduled, nominal eligibility is one bulk turn per 1 s ageing plus up
to 100 ms polling, each class within three such turns. Add CPU scheduling delay,
FIFO work already admitted, the current atomic step/commit/filesystem operation,
and an in-flight synchronous development-clock drain. This is a bounded service
opportunity in the host scheduler, **not** a hard 3.3-second wall-clock completion
promise. Commodity OS starvation, stalled I/O and application/storage failures
cannot be assigned a finite wall-clock bound here. Persistently failing or parked
work needs repair; the mechanism does not turn failure into completion.
The bound is per bulk kind, not per queued item. Engine selection within a kind
is unchanged: delivery/recounts visit schema order, and jobs select the oldest
queued/running job. An endlessly replenished earlier view can still delay a
later view; this lane does not introduce per-view fair queuing or a completion
bound under unbounded arrivals. For the finite replay backlog, every measured
trial requires the whole queue to empty.

A deterministic regression never starts the low-priority thread and verifies
that three aged ordinary turns complete an actual queued job. Another regression
holds the coordination gate, queues an ordinary waiter, and proves the next bulk
acquisition cannot overtake it. Existing engine FIFO tests retain their 1 ms quiet
window, 5 ms maximum deferral and immediate sustained-contention admission checks.

## Measurements

The three-way small mixed fixture is exactly the corrected round-2 workload at
0/48/96/144 busy arithmetic processes: 125-second real-clock windows, continuous
reads, expiring writes, minute schedules, supervised effects, retries, deliberate
deadline failure and maintenance-only abandoned-lease recovery. Binary order
rotates by load. There is one cell per design/load; maxima include phase, polling
and host scheduling and do not estimate a hard bound.

A separate split-only matrix adds 100 followers and 1,000 real Following event
deliveries to that same combined workload. Its initial emission consists of ten
ordinary 100-event transactions. It records pending count and time-to-empty
alongside all original assertions. Backlog tail observation remains under the
same synthetic load even if it outlasts the 125-second read window. This fixture
is synthetic; it is separate from the actual calibration checkpoint below.

The calibration qualification replays the retained builder packet through 50%,
verifies its invariants, stops the server and restores the identical SQLite
snapshot before every trial. Preparation observed 6,551 pending delivery tasks;
the closed snapshot holds 6,507 because shutdown allowed another 44 to finish.
Each design gets two reversed-order trials at zero and 96 busy processes.
Busy children are ready and have run for two seconds before the server starts.

The eight endpoints, published 0.4.10 client, 23 sequential calls/cohort and
first-three warmup exclusion match the prior builder probes. Cohorts repeat while
backlog drains. A separate worker polls read-only queue state every 100 ms plus
query time and observer scheduling. It contributes host work but does not block
the probe client's event loop. The conservative distribution includes responses
completed before the final positive queue observation. The last-positive to
first-empty interval bounds observational uncertainty; all tail samples remain
in the raw record. Sample count differs with drain duration. Per-cohort and
per-trial distributions accompany pooled nearest-rank p50/p95.
Pooling weights the successful samples, not each trial equally; changing drain
duration also changes how many cohorts see each intermediate Following state.
The individual trial records remain the comparison for run-to-run variation.

During-drain Following answers are expected to change. All answer digests are
retained, with only the existing `asOf` normalization. After drain, each trial
requires empty queues and a stable commit head for one second, then captures all
eight final hashes; equality across designs/loads/trials is checked separately.
This does not rewrite `complete` to mean “all deliveries arrived.”

This is the same shared EPYC host, not an exclusive machine or a Mac runtime
qualification. Other tenants are observed, never stopped. The lane's own builds,
full suite and smokes finish before the primary matrices. No speedup target is
inferred from a favorable endpoint or one cell.
