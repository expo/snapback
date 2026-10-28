# G5R: clock-free coalesced validation

Historical prototype/round-2 record. [G5RF fix round 1](./FIXROUND1.md)
subsequently accepts RI as the Postgres default; the experimental/default-off
descriptions below describe the original measured revisions.

Experimental `SNAPBACK4_G5_READ_INDEX=1`, default off. The Review design is
[LLP 3000.009.001.000.002 §4.2](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#g5-read-index-validation).
This lane uses a private PG16.15 cluster on port 55731 and the lane's own
`/home/ccheever/projects/sb4-g5r/target`. It makes no publication or matched
Convex/Supabase qualification claim.

## What the old 5,656/s rung means

The [S1 reads](../../experiments/scale-controls/results-20261025-s1-reads/README.md)
record 5,656/s as the highest tested passing G5 rung for W2/W3 A/B. It is not
an intrinsic, universal G5 ceiling. The subsequent
[S1 diagnosis](../../experiments/scale-controls/results-20261025-s1-diagnosis/README.md)
replays G5 W2 at 8,000/s successfully, including the archived release. Shared
host conditions, cold state and queues matter.

A current warm G5 hit pays one unnamed Parse/Bind/Execute/Sync statement,
including fresh ordinary session/read-session/principal/worker authority,
store/generation/code identity, revision and head. It parses/plans that SQL
again on each hit; the earlier named-prepare contrast was disqualified by
its extra cold flight. The completed independent implicit transaction needs
no later wire ROLLBACK. Rust hashes/validates the request key, updates the
bounded cache directory, decodes authority/metadata, runs the shared resolver
and expiry checks, clones the immutable result and sends its existing
preencoded data with unchanged logical meters. There is no query-body
interpretation or application-row fetch on a hit. Failed validation plus an
ordinary miss pays both paths; W2's cache pressure is an independent cost.

The hit occupies one of **30 executing short workers** throughout, plus a
pipeline-depth permit and shared connection custody during its SQL await.
The physical pool is bounded at 30, including reserved pool writer capacity,
with the existing main writer/lease within 32 total; it is not a new pool.
A miss/fallback needing a transaction has exclusive connection custody.
The bounded HTTP waiting population remains unchanged.

The diagnosis's failing 8,000/s G5 W2 A trace has **1.000 data statements per
lookup**, query-await p50/p99 **3.02/6.38 ms**, permit/custody p99
**0.0008 ms**, worker admission p99 **14.90 ms**, and worker queue max
**119**. Native PG uses **5.41 of six pinned logical CPUs**, versus **0.81**
in G6; the transport permit is not the measured bottleneck. SQL
planning/execution CPU pressure lengthens worker residence and HTTP/client
queues; overloaded intended-arrival tails approach the unchanged one-second
deadline. Original G5 release loopback attribution is W2/W3 PG
**656/662 µs/read**, server **267/279 µs/read**, at about 96%/98% reuse
(LLP §6). W3 uses the same G5 validation SQL when it hits, but the cited
5.41-CPU trace is W2 evidence, not an independently observed W3 CPU count.
Pure `30/RTT` arithmetic does not explain these results. W1's million-key
nonrepeating stream gets no useful hit benefit.

## Protocol and proof

The leader reads owner token/holder/store, generation, code, durable revision
and public head in one fresh independent statement. Enrollment closes before
submission; arrivals during that flight join the next round. Its snapshot is
after every enrolled invocation and sees commits acknowledged before those
invocations. Exact complete stamp equality certifies the immutable fill's
result **and** frozen authority facts. Each read still runs its own shared
Rust authority/expiry resolver. The snapshot acquisition is a linearization
point inside each successful read's interval. Later concurrent commits may
follow that point. No clock rate, jump, lease duration or timely notification
proves a hit. PostgreSQL's [snapshot rule](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED)
and [Sync transaction boundary](https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY)
are the underlying database premises.

Any revision mismatch misses; own acknowledged writes and successor writes
therefore cannot be hidden by a cached fill. Existing uncertainty/revocation
latches bypass RI before enrollment and are rechecked after authority.
Failures take ordinary G5. Cold fills, eligibility, budgets and logical
meters retain their existing path. One running round and one pending round
hold at most 30 enrollees; the elected request uses its existing reader,
with no thread or dedicated connection. Late arrivals may wait the remainder
of one flight and their next flight; two RTT excludes queueing and is not a
latency bound.

Stage E's D gate bypasses this prototype and retains gated G5. Stage R is
not implemented in this checkout: its H can lag W, so this raw H proof is
insufficient. The Review subsection specifies W-tagged immutable entries,
acquire/recheck ordering, per-client sequence minima and coherent two-image
fills, including whole-snapshot restart. Neither composition is qualified by
this prototype. The synchronous O profile needs no new public RYW token;
post-ACK invocation ordering already gives the required minimum revision.

Coordinator deadline/cancellation witnesses cover independent waiter expiry,
capacity refusal and leader unwind. The current synchronous query interface
has no per-read cancellation token; a disconnected caller does not cancel a
shared PG statement needed by other readers. The existing 5 s PG timeout
still bounds that statement, and fallback does not promise a 1 s total HTTP
deadline. This remains a prototype limitation.

## Witnesses and verification

The first RI-on cache-suite pilot exposed an extra authority-callback pass
after G6 revocation, stranding the drain witness's two callback releases.
Only the identified owned test PID was recorded/stopped. RI now bypasses an
already revoked or uncertain grant, preserving ordinary G5 fallback. The
corrected full private-PG cache/grant suite passes **40/40**, including the
new coordinator and real-PG witnesses. A later self-review also makes nullable
owner identity decode fail closed, with a missing-holder witness.

The real foreign-writer witness holds an already returned old statement
snapshot, commits a changed body through a separately attached fenced engine,
and only then invokes a read. That read joins the next round and returns the
new body. RYW, authority revocation, takeover, expiry, one-flight/meter/wire
parity, uncertainty, D-held visible snapshots, and the G6 oracle remain
covered. Coordinator witnesses put 20 late arrivals into exactly one second
round, reject a 31st enrollee, expire a waiter without cancelling its leader,
and release custody after a leader panic.

Final suite counts, local measurements and cleanup receipts follow below.

## Final verification record

[Aggregate verification](./verification.json) retains every pilot disposition
and the broad run's failures. Final relevant checks:

| Check | Result |
| --- | --- |
| Core unit suite, default posture | 881 passed, 0 failed, 503 ignored |
| RI-on complete cache/G6/D suite | 40 passed, 0 failed |
| Final RI coordinator + real-PG witnesses, including malformed owner catalog | 5 passed, 0 failed |
| Applicable socket transport/custody/pool tests | 7 passed, 0 failed |
| CLI parallel unit suite | 670 passed, **4 timing/admission failures**, 75 ignored |
| Serial reruns covering those four failures | 13 header tests + 1 route test + 1 timed-authority test passed |
| CLI round-trip group with private PG and psql available | 10 passed, 0 failed; two manual measurement helpers return without measuring unless explicitly armed |
| Private-PG CLI startup/configuration tests | 2 passed, 0 failed |
| Invalid RI flags `2`, `true`, empty | All three refuse before serving |
| `./ref-check --verbose` | 575 LLP documents, 12,174 refs, 0 errors, 0 unchecked |
| Diagnostics registry generator | Executed; no projection changed (Snapback 4 is outside its production roots) |
| `git diff --check` | Passed |

The broad core check preceded the nullable-owner decode hardening; that
hardening's changed RI path is covered by the final five witnesses, and the
subsequent CLI round-trip/startup runs use the final implementation. The broad
CLI failures are not erased by their passing serial reruns. No full publication
battery, TCP transport qualification, Stage R/E RI composition, or default-on
promotion is claimed.

## Local measurements

**G5-RI reduces SQL and PG CPU substantially, but this implementation does not
establish a clock-free default that beats Convex in every requested cell.**
In particular, the delayed W2/W3 RI rungs fail above 8,000/s. G5 itself also
passes some higher rungs on this larger host: 5,656/s is not a universal ceiling.
The short windows have large, non-monotonic client dispatch tails, including
G5/G6 failures, so this is diagnostic evidence, not a matched-control capacity
qualification or a causal speedup estimate.

There are **126 primary windows** and **30 retained warm-W1 pilot windows**.
All primary aggregates are in [measurements.json](./measurements.json), the
[full 102-row rate table](./TABLE.md), [CSV](./table.csv), and
[compact comparisons](./COMPARISON.md). The primary windows schedule
**4,590,600 measured arrivals**, retaining **83,106 errors** from overloaded
rungs. No failed window is replaced. All sampled store connection counts are
**32**, with no additional validation connection. CPU is valid for **93/126**
primary windows; the remaining 33 values are `null`, not zero or imputed.

At the requested strict-above-8,000 rung (50 ms read SLO; one primary window
per entry):

| Cell at 9,514/s | G5 p99 ms | G5-RI p99 ms | G6 p99 ms |
| --- | ---: | ---: | ---: |
| W1/A | 27.116 ✓ | 34.308 ✓ | 12.894 ✓ |
| W1/B | 21.627 ✓ | 17.646 ✓ | 19.481 ✓ |
| W2/A | 59.113 **fail** | 33.309 ✓ | 49.873 ✓ |
| W2/B | 49.906 ✓ | 174.719 **fail** | 35.389 ✓ |
| W3/A | 48.660 ✓ | 61.571 **fail** | 55.837 **fail** |
| W3/B | 61.178 **fail** | 598.213 **fail** | 50.627 **fail** |

At 8,000/s, below are medians of the two window quantiles, not a pooled p99.
Pass counts retain the individual outcomes. PG CPU medians use only valid
snapshots, with their count shown. CPU's measured window is four seconds;
SQL counts cover the six-second cohort, including warm-up, framing and lease
traffic but excluding the SQL observer. Do not turn failed-window CPU/ACK into
a steady-state per-read cost: overloaded requests can drain after the CPU window.

| Cell at 8,000/s | Tier | p50/p99 ms | PG µs/ACK (valid n) | SQL/ACK | Passes/windows |
| --- | --- | ---: | ---: | ---: | ---: |
| W2/A | G5 | 1.785/69.042 | 718.4 (1) | 1.0020 | 0/2 |
| W2/A | G5-RI | 2.334/67.617 | 93.6 (2) | 0.1693 | 0/2 |
| W2/A | G6 | 0.369/59.163 | 41.9 (1) | 0.0765 | 1/2 |
| W2/B | G5 | 2.137/52.314 | 695.9 (2) | 1.0021 | 1/2 |
| W2/B | G5-RI | 3.260/53.985 | 83.4 (2) | 0.1466 | 1/2 |
| W2/B | G6 | 0.359/51.511 | 41.6 (2) | 0.0794 | 1/2 |
| W3/A | G5 | 1.560/50.397 | 726.3 (1) | 1.0020 | 1/2 |
| W3/A | G5-RI | 2.389/50.774 | 59.2 (2) | 0.1046 | 1/2 |
| W3/A | G6 | 0.332/51.479 | 2.2 (1) | 0.0031 | 0/2 |
| W3/B | G5 | 2.297/42.500 | 781.1 (2) | 1.0020 | 2/2 |
| W3/B | G5-RI | 3.531/51.118 | 49.8 (2) | 0.0801 | 1/2 |
| W3/B | G6 | 0.354/64.143 | 1.6 (1) | 0.0031 | 0/2 |

For example, W2/A falls from **1.0020 to 0.1693 SQL statements/ACK** and from
**718.4 to 93.6 PG µs/ACK** in the valid 8,000/s samples. That is about 83%
fewer statements and 87% lower observed PG CPU. W3/B falls from **1.0020 to
0.0801 statements/ACK** and **781.1 to 49.8 PG µs/ACK**. These are serial
shared-host contrasts, combining a narrower statement and batching; they do
not isolate either contribution or establish a guaranteed CPU reduction.

**The next limit is not the physical reader pool.** The prototype retains
30 executing short workers and holds one while awaiting its round. The
necessary residence condition is `lambda × mean(worker hold) <= 30`, plus
queue-tail margin. Delayed RI medians reach about 3.3–3.8 ms around 8,000/s,
leaving little margin; this median arithmetic is diagnostic, not a mean bound.
At W3/B 16,000/s, the RI window has **28,991 deadline errors / 64,000 arrivals**,
while PG work is only about 0.108 SQL/ACK and valid PG CPU about 72 µs/ACK.
That behavior is consistent with the extra proof wait consuming the fixed
worker population. Exact worker-wait causality was not instrumented/ablated;
client dispatch and shared scheduling also contribute.

A future experiment should await coalesced proof outside the scarce execution
permit, while retaining bounded waiting requests and the physical cap, or
measure bounded overlapping rounds. Merely assuming CPU-bound G6 throughput
for a blocking single-round implementation is unsound. Neither alternative
was silently introduced here. Stage R/E composition remains separate.

### Write cost

All twelve W4 windows pass with **zero errors** and **43,200 cohort ACKs**,
including warm-up. Every counter delta equals its ACK count. The program write
path gains no RI statement or flight: RI is entered by eligible query reuse.
Valid paired PG CPU samples are about -6%, -3.5% and 0% for RI versus G5;
B/800's G5 CPU snapshot is invalid, so it supplies no CPU comparison. SQL/ACK
varies with physical group fill (including an approximately +8% A/800 RI
sample), and the p99 differences are retained below. These short observations
support no introduced write protocol work, not exact cost equality or a
statistically bounded overhead claim.

| W4 link/rate | Tier | p50/p99 ms | PG µs/ACK | SQL/ACK | Cohort ACKs = counter delta |
| --- | --- | ---: | ---: | ---: | ---: |
| A/400 | G5 | 4.485/8.741 | 1575.0 | 25.836 | 2,400 |
| A/400 | G5-RI | 4.473/8.462 | 1481.2 | 25.633 | 2,400 |
| A/400 | G6 | 4.559/8.733 | 1325.0 | 24.922 | 2,400 |
| A/800 | G5 | 5.546/17.023 | 1084.4 | 17.003 | 4,800 |
| A/800 | G5-RI | 4.903/7.172 | 1046.9 | 18.359 | 4,800 |
| A/800 | G6 | 5.001/6.779 | 1093.8 | 18.155 | 4,800 |
| B/400 | G5 | 6.738/10.052 | 1768.7 | 26.200 | 2,400 |
| B/400 | G5-RI | 5.698/8.552 | 1768.7 | 26.569 | 2,400 |
| B/400 | G6 | 5.108/7.606 | — | 26.812 | 2,400 |
| B/800 | G5 | 6.791/9.257 | — | 13.077 | 4,800 |
| B/800 | G5-RI | 6.844/9.896 | 893.8 | 12.882 | 4,800 |
| B/800 | G6 | 6.246/8.364 | 868.8 | 13.850 | 4,800 |

### Method, pilots and limits

The unchanged current S1 native seed, load generator and Unix delay proxy use
1,000,000 messages, 1,025 rooms, 256 users, 8,448 memberships and 257 counters,
plus engine-owned maintained-column families with 256/1,024 rows. No maintained
total is assigned by the fixture. Native preparation takes 1,716.92 seconds.
There are 128 read clients and 32 writers. A adds 250 µs/direction; B adds
500 µs/direction. Every cell uses 2 s warm-up and 4 s measurement. W2/W3 use
an additional four-second untimed prime per service, rotating three-arm sweeps,
and reverse-order repeats at 8,000/11,313. W4 tests 400/800. The tested release,
seed and generator SHA-256s are retained in the JSON; they are unchanged across
arms. No owned build or test overlaps a timed window. The EPYC 9454 has 48
physical/96 logical CPUs; no affinity or quiet-host qualification is claimed.
The observed timed-boundary free-space minimum is **61.65 GiB**.

The first short W1 sweeps accidentally retained keys across rate steps, giving
G6 useful hits unlike the long S1 W1 campaign. All 30 windows remain as the
explicitly excluded warm-W1 pilot. The corrected primary W1 run starts a fresh
service for every rate and arm, without repeated-key priming, and observes
roughly one SQL statement per read across all arms. No measured W2/W3/W4
window was discarded. Earlier setup attempts fail before any timed window:
the generated maintained families were initially omitted from the row-count
assertion; the proxy owns directory creation; and the new endpoint requires a
stable socket binding in both private deployment records. The driver now uses
the original `/auth/config` readiness door. Only private fixture metadata was
rebound; immutable application source and product admission checks were unchanged.

The first measurement controller also stops before any window at the
conservative **60 GiB = 64,424,509,440-byte** free-space guard. All owned workload
processes are stopped, only this lane's artifacts pruned, and the full fixture
preserved. After the shared filesystem recovers above 72 GiB, measurement
restarts from that fixture under the same guard. No threshold is weakened.
The initial stop and restart are disclosed, rather than presented as an
unfinished matrix. Two explicit checkpoints run during preparation/idle time,
never during measurement. PG16.15 retains fsync/synchronous_commit/
full_page_writes on, 256 MiB shared buffers, max_connections 100,
max_wal_size 1 GiB/min_wal_size 80 MiB and JIT off.

The current generator's fail-closed CPU census reads the whole host's `/proc`
before selecting the private PG family. An unrelated PID disappearing can
invalidate the family snapshot; this accounts for missing CPU values and is
not treated as zero PG work. The SQL counts and all latency/error samples
remain. CPU includes private PG background work; source statements and sampled
CPU are different metrics. G6 is the explicit Linux `1000,250` clock-bounds
control; it does not qualify arbitrary clocks or make G6 a default.

**Disposition:** keep the flag default off. The clock-free correctness prototype
and CPU benefit merit follow-up, but this blocking one-round implementation is
**not demonstrated as a default candidate that strictly beats Convex 8,000/s
on W2/W3 A/B**. The next performance experiment must address worker residence,
and any default promotion still needs the relevant supported-writer/publication
and Stage R/E evidence. No publication or broader competitive win is claimed.

The stopped private fixture and raw logs remain under `/tmp/sb4-g5r-work`,
with data in `/tmp/sb4-g5r-work/pg`, former port 55731. No PG directory is
deleted. A resumed diagnostic must restart only that owned cluster and record
its new postmaster PID before using `measure.py --stage measure` (or
`--scope w1fresh`). Final PID/free-space and executable receipts are in
[cleanup.json](./cleanup.json). No push, stash, Git configuration change or
credential copy is performed.


## Round 2 — G5R2 on expo-build-450a (2026-10-28)

Worktree `/home/ccheever/projects/sb4-g5r2`, branch `sb4-pg/g5r2`, starts
at the requested `08a9731b597f27cb7e79b47f7268fd3472b5efa2`. The hostname
is `expose-builder-nothing`; its Tailscale address `100.84.186.119` resolves
as expo-build-450a. This is the Ryzen 5 3600 (six physical/twelve logical
CPUs), not Round 1's EPYC host. 450b is untouched.

### Continuation design

The flag remains default off. HTTP reads select an immutable cached candidate,
return the detached reader and publication lease, and park their continuation
while retaining their bounded socket-admission slot. They retain no execution
worker, PG connection/transaction or transport permit. A single timer closes
collection after 200 microseconds and pipelines at most two validation flights
through two workers borrowing the unchanged pool. The 30 request workers and
32 physical application-connection cap are unchanged. Enrollment closes before
statement submission; the statement snapshot remains each successful read's
linearization point. A proof belongs to its original cache and request key.

The independent timer bounds proof waiting to 8 ms before ordinary G5 fallback.
It does not cancel a statement needed by other readers. Resumption preserves
the original intake/body deadline, reacquires publication admission and a
reader, rechecks the program/arguments, authority/expiry and uncertainty latch,
and consumes its proof once. HTTP fallback and generation handoff cannot
re-enter blocking RI. The deadline is a wait bound, not a freshness clock
assumption. Aborted response chains are removed while parked; a TCP half-close
continues to have the existing semantics described in the LLP. Direct core
callers retain their synchronous API; the scarce HTTP execution pool uses
continuations.

The explicit qualification trace now transfers wall/CPU timing across the
continuation. Separate opt-in release tracing (`SNAPBACK4_READ_TRACE_ALL=1`,
with `SNAPBACK4_READ_TRACE` naming a new private output file) records intake,
parse/preparation, candidate lookup, parked/resumed, query, encoding and write
stages without credentials, arguments or answers. Normal cohorts leave it off.

### Reproducer and verification record

[`round2.py`](./round2.py) extends the checked-in `s1-onehost.py` lifecycle,
fixture, affinity, quiet gate, native load generator and SLO. The registered
matrix is W1/W2 A/B at 8,000/9,514/11,313; W3 also 16,000; W4/A at
800/2,262; three rotating interleaved arms and three repetitions. Default
windows retain S1's 10 s warm-up plus 20 s measurement. A/B proxy RTTs
500/1,000 microseconds split into 250/500 microseconds per direction.
PG/app/load affinities are `0-2,6-8` / `3-4,9-10` / `5,11`.

Private witness PG uses port 55742; campaign PG uses 55743. All native tools
build under this worktree's `target`, with `CARGO_PROFILE_DEV_DEBUG=line-tables-only`
and incremental compilation disabled. Preflight requires 24 GiB; continuous
monitoring stops below 22 GiB. No old SPR target artifact, release binary or
fixture is removed. No push, origin fetch, stash, Git configuration change,
credential copy or 450b access is performed.

The first private-PG launcher was killed with its tool process group after its
short controller exited. That setup supplied no usable test result; all three
HTTP and all 39 cache tests initially refused the absent socket. Restart uses
recorded postmaster identity and its own session, without deleting the cluster.
The first real cache run passes 38/39; the new uncertainty witness incorrectly
asked an unowned fixture for an owned-handle latch. It now uses an actual
fenced owner. The first HTTP fixture used a constant-only query, which the
bounded read-closure cache deliberately excludes; the corrected witness uses
an ordinary indexed row read. Compilation/setup failures remain disclosed and
supply no passing witness counts.


### Round 2 verification before measurement

| Check | Result |
| --- | --- |
| Core unit suite, default posture | 881 passed, 0 failed, 504 ignored |
| CLI unit suite, serial | 674 passed, 0 failed, 78 ignored |
| Private-PG cache/G6/D + coordinator suite | 42 passed, 0 failed |
| Final core receipt/probation/RYW/uncertainty witnesses | 3 passed, 0 failed |
| Final HTTP parking/deadline/disconnect/ownership witnesses | 4 passed, 0 failed |
| Private-PG CLI round-trip group | 11 passed, 0 failed; two explicitly gated measurement helpers do no measurement |
| Ref checker | Passed: 575 LLPs, 12,176 refs, no errors/unchecked refs |
| Whitespace check | Passed |

The broad runs precede the final candidate-probe hardening. Its focused
witness verifies that a probe is read-only: the first real read still cannot
admit a fill, and the second does. Receipt tests reject a previously completed
proof supplied to a later enrollment and recheck a sticky uncertainty latch.
The final HTTP witness accounts both parked reads and legitimate ordinary-G5
fallback from a contended nonblocking cache-directory probe; it checks zero
active short workers, all reader loans free, preserved bounded admission and
progress on `/auth/config` while both validators are held. Deliberately held
exchanges use the existing held-exchange guard. A failed earlier exact-count
witness is retained, not interpreted as a product worker leak.

The initial broad CLI attempt was stopped after worker-watchdog failures
because only test executables had been built. Building its normal sibling CLI
resolves that setup precondition; the complete serial rerun above passes.
The compiler/profile settings use the repository's SQLite durability flags
as well as the requested line-table debug profile.

`check-inventories` ran and remains red on unchanged Snapback 1 inputs:
missing ignored generated demo/Contract leaves and an existing diagnostics
removal-ledger mismatch. All changed Rust is outside the diagnostics registry's
production roots (`scripts/diagnostics-registry-source.mjs`); no registered
emitting site moved, so no registry regeneration or unrelated root bootstrap
is performed. This is not publication qualification.

[Structured verification receipt](./round2-verification.json). The private
port-55742 postmaster is stopped, its PID file absent, and its test cluster and
this lane's completed debug artifacts are removed. The SPR release and fixtures
remain untouched. Pre-release `/home` free: 28.1 GiB.


The final continuation stores the absolute deadline once at dispatch; later
parser phases cannot replace it. Its settlement start and spent generation
handoffs also cross the park unchanged. The fourth HTTP witness gives a read
a 30 ms original deadline and a five-second proof budget, holds validation,
and requires the original admission to expire without data. All four pass in
an unoptimized debug witness build; the broad suites above used the normal
optimized test profile. The first attempt at that focused build omitted psql
from PATH; rerunning with the private PG tools available passes unchanged.

The S1 seed helper's separate lockfile did not match its current workspace
core and referred to uncached browser metadata. It is aligned with the
workspace's compatible versions. An isolated Cargo home refreshes only public
crates.io index metadata and reuses public dependency archives; no credentials
or Cargo configuration is copied. CLI, load generator and native seed helper
all build in the lane's own target. No benchmark query or fixture source is
changed by the lock alignment.


### Excluded S1 driver pilot

The completed 1,000-message pilot has six passing 100/s windows (W3/B and
W4/A across all three arms), zero errors and exact write counters. It is
excluded from the main matrix. The native generator validates a minimum
32,768-row address range even for W3/W4, which do not use that parameter;
only this excluded pilot uses that placeholder with a smaller fixture.
Parser CPU clocks are present on every traced query, and RI traces contain
parked/resumed reads. [Pilot receipt](./round2-pilot.json).

Earlier excluded setup attempts record no timed window for the relocated
initdb library path and minimum-row validation failures. One passing W3/G5
window precedes a next-arm startup refusal while the former lease is still
live. The corrected driver waits for the stopped owner's lease and read grant
to expire before starting another arm, outside timing and without changing
private catalog state. All owned pilot processes are stopped; the postmaster
PID file is absent before deleting its scratch PG data. Only owned release
intermediates are pruned, retaining the three hashed tools for the full run.

### Round 2 primary result — 450a, 2026-10-28

**The clock-free RI arm passes 11,313/s in all three repetitions on
W2/A, W2/B, W3/A and W3/B.** Worst repetition p99 is respectively
29.360, 38.666, 25.706 and 45.941 ms. This is 41.4125% above the pinned
8,000/s Convex advocate rungs for the first three cells and 100.0177%
above W3/B's 5,656/s rung. These are comparisons with the supplied pinned
rungs, not a new simultaneous Convex campaign or a portable hardware claim.
The flag remains **default off** and the design remains Review; the ordinary
G5 default still fails those 8,000/s cells here.

There are **198 primary windows**: 180 reads and 18 writes, retaining every
repetition. Read pass counts are G5 **9/60**, RI **44/60**, G6 **43/60**;
including W4, they are **15/66**, **50/66**, **49/66**. RI's 36 W2/W3
windows through 11,313/s all pass; they have four measured errors total,
with the worst window at 0.0025% errors. Both W3 16,000/s cells fail for
all three arms in every repetition. W1 remains cold and gives no reuse
benefit: all arms pass 8,000/s on both links, while at W1/A 9,514/s G5
passes 3/3, RI 2/3 and G6 1/3; W1/B 9,514/s fails throughout. No failing
window is replaced, and 11,313/s is the highest passing requested RI rung,
not an inferred exact capacity ceiling.

The native seed takes 1,816.6 seconds and verifies 1,000,000 messages,
1,025 rooms, 256 users, 8,448 memberships and 257 counters. Initial and
final message images and maintained room/sender totals have zero mismatches.
The primary source is `a93cd8e434e7166a9b30fdfe63b91c4a5678339c`, including
product changes `b37dadc513` and `a9758c07f1`. Server SHA-256 is
`6e5570687b07321d289bb6b0271b1fdd0b70e0f038421a02a55d341d04c819fd`;
the generator/seed hashes and CPU affinities are in the structured receipt.

[Every window](./round2-measurements.json), [66-row p50/p99/CPU/SQL table](./ROUND2-FULL.md),
[aggregate CSV](./round2-table.csv), [aggregate JSON](./round2-aggregate.json).
The compact table below gives **passes/3; worst repetition p99 in ms**.
Read SLO is p99 ≤50 ms and errors ≤0.1%; W4 uses p99 ≤100 ms with the
same error bound and exact native counter reconciliation.

| Cell | Offered/s | G5 | G5-RI | G6 |
| --- | ---: | ---: | ---: | ---: |
| W1/A | 8,000 | 3/3; 11.633 | 3/3; 13.582 | 3/3; 17.842 |
| W1/A | 9,514 | 3/3; 47.186 | 2/3; 62.030 | 1/3; 61.047 |
| W1/A | 11,313 | 0/3; 1016.070 | 0/3; 1016.070 | 0/3; 1016.594 |
| W1/B | 8,000 | 3/3; 27.132 | 3/3; 42.992 | 3/3; 25.084 |
| W1/B | 9,514 | 0/3; 314.311 | 0/3; 708.837 | 0/3; 90.440 |
| W1/B | 11,313 | 0/3; 1016.070 | 0/3; 1016.070 | 0/3; 1016.070 |
| W2/A | 8,000 | 0/3; 1021.837 | 3/3; 4.858 | 3/3; 12.591 |
| W2/A | 9,514 | 0/3; 1023.934 | 3/3; 10.715 | 3/3; 15.139 |
| W2/A | 11,313 | 0/3; 1026.032 | 3/3; 29.360 | 3/3; 26.673 |
| W2/B | 8,000 | 0/3; 1022.886 | 3/3; 11.551 | 3/3; 6.148 |
| W2/B | 9,514 | 0/3; 1023.410 | 3/3; 12.796 | 3/3; 15.466 |
| W2/B | 11,313 | 0/3; 1025.507 | 3/3; 38.666 | 3/3; 29.065 |
| W3/A | 8,000 | 0/3; 1021.313 | 3/3; 4.168 | 3/3; 1.775 |
| W3/A | 9,514 | 0/3; 1024.459 | 3/3; 8.245 | 3/3; 4.239 |
| W3/A | 11,313 | 0/3; 1025.507 | 3/3; 25.706 | 3/3; 15.073 |
| W3/A | 16,000 | 0/3; 1024.459 | 0/3; 89.326 | 0/3; 60.490 |
| W3/B | 8,000 | 0/3; 1021.837 | 3/3; 5.915 | 3/3; 2.679 |
| W3/B | 9,514 | 0/3; 1023.410 | 3/3; 12.206 | 3/3; 8.094 |
| W3/B | 11,313 | 0/3; 1023.934 | 3/3; 45.941 | 3/3; 9.937 |
| W3/B | 16,000 | 0/3; 1024.459 | 0/3; 121.111 | 0/3; 58.819 |
| W4/A | 800 | 3/3; 17.940 | 3/3; 14.787 | 3/3; 15.909 |
| W4/A | 2,262 | 3/3; 87.032 | 3/3; 22.544 | 3/3; 44.007 |

### Round 2 costs and remaining limit

CPU and SQL below are medians across the three **whole-cohort** samples:
warm-up, measurement, drain and native observer/barrier framing, divided by
ACKs in that same interval. All 204 samples have the private-family PG CPU
census; the native measured-window PG census has ten nulls, retained as nulls.
The failed G5 windows are descriptive overloaded costs, not steady-state
throughput estimates. Every sampled application connection count is ≤32.

| 8,000/s cell | G5 PG µs/ACK; SQL/ACK | RI PG µs/ACK; SQL/ACK | G6 PG µs/ACK; SQL/ACK |
| --- | ---: | ---: | ---: |
| W2/A | 740.1; 1.00360 | 161.8; 0.34862 | 84.1; 0.15793 |
| W2/B | 741.9; 1.00364 | 137.5; 0.28512 | 88.5; 0.16163 |
| W3/A | 782.7; 1.00366 | 98.3; 0.23334 | 6.9; 0.00834 |
| W3/B | 782.3; 1.00371 | 70.0; 0.15591 | 7.1; 0.00834 |

Round 2 does not reproduce Round 1's W2/A 0.169 SQL/ACK: its bounded
200 µs collection/two-flight design measures 0.349 here. Its improved tails
and strict-above-pin pass counts are the useful result; host/window/design
differences prevent assigning the SQL difference to a single cause.
G6's W2 costs also include ordinary misses; this workload is not a zero-SQL
G6 path throughout the window.

The primary native generator records process CPU and separate intended-arrival
dispatch/HTTP-service clocks with tracing disabled. CPU process order is
checked against the recorded PIDs: server, proxy, then the generator's own PID.
The pinned load CPUs `5,11` are siblings on one physical core. At W3 16,000/s:

| Primary cell/arm | Generator logical CPU-seconds/s | Server CPU-seconds/s | Dispatch p99 ms | HTTP service p99 ms |
| --- | ---: | ---: | ---: | ---: |
| W3/A RI | 1.976 | 2.884 | 67.830 | 15.188 |
| W3/A G6 | 1.957 | 1.892 | 46.432 | 11.330 |
| W3/B RI | 1.955 | 2.940 | 94.437 | 17.662 |
| W3/B G6 | 1.965 | 1.868 | 49.840 | 11.256 |

These are medians of window values, not additive stage quantiles. The dominant
observed excess is in generator dispatch, with its two logical CPUs nearly
full. RI also consumes more application CPU than G6; the server/proxy share
two physical/four logical CPUs, so logical idle time alone is not a physical
headroom proof. The clocks identify generator scheduling as a remaining
one-host tail limit; they do not establish a sole intrinsic engine ceiling.
At W2/B 11,313/s RI's dispatch/service p99 medians are 18.596/11.559 ms,
with generator/server CPU 1.818/2.140 logical CPU-seconds/s.

[High-rate clock diagnostics](./round2-attribution.json) contain six separate
2 s warm-up/4 s traced windows at W2/B 11,313 and W3/B 16,000. All fail:
the opt-in synchronous trace writer serializes JSON directly to a File under
a mutex after the response, producing many small writes while the request
worker finishes. Those runs show a logging-induced worker queue and cannot
explain the primary p99 numerically. This qualification instrumentation is
not enabled in the primary matrix. No instrumentation rebuild changes the
primary product bytes.

Six additional **1,000/s diagnostic-only** windows reuse the stopped private
million-message fixture after custody/PID-file/process-birth/binary-hash checks,
with the same native S1 affinity, cap, 128 readers and quiet gate. They use
10 s warm-up/4 s measurement; all pass without errors. The first reuse setup
refuses an already-created custody metadata file before any PG startup or
timed traffic; the corrected attempt updates only its own metadata. These
windows do not enter the capacity table. W2 has only 916 parked samples in
this shorter arrival history, so the cache CPU numbers explicitly condition
on parked reads; W3 has 13,551. No whole-window warm-cache claim follows.

| Low-rate RI parked samples | n | Parser CPU mean µs | Candidate lookup CPU mean µs | Resume query CPU mean µs | Encode CPU mean µs | Park + resume-queue p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| W2/B | 916 | 25.96 | 13.82 | 26.25 | 6.97 | 2.038 |
| W3/B | 13,551 | 22.24 | 11.91 | 22.46 | 5.27 | 2.093 |

The resumed query includes ordinary authority/stamp work. Mean active-worker
CPU for these parked samples is 149.10/129.89 µs; parser CPU is measured on
its intake thread separately. The request's accepted timestamp starts after
headers, so its post-header intake span is not a kernel socket-accept clock.
Whole-server clocks retain the additional HTTP/socket/admission/scheduling
cost; these probes do not isolate accept CPU or assign the residual to it.
Lookup and encoding are measured small components, while the primary native
clocks expose the dispatch tail. The 2.0–2.1 ms parked p99 is about two B RTTs
in this unsaturated diagnostic; at saturation the recorded parked span also
includes resumption queueing. The independent 8 ms timer bounds proof waiting,
not scheduler delay or total HTTP p99. Stage quantiles are neither additive
nor paired decompositions of a primary-window request.

[Low-rate windows](./round2-lowrate-clocks.json),
[conditional stage clocks](./round2-lowrate-attribution.json).
Reproduce the additional clocks using `round2.py --clock-diagnostics-from
/tmp/sb4-g5r2-campaign --warmup-ms 10000 --duration-ms 4000` with new `--out`
and `--result` paths. The helper uses the existing private fixture token files
in place; it never copies credentials or changes the stored PG settings.

### Round 2 writes, custody and disposition

All **18 W4/A** windows at 800 and 2,262/s pass the write SLO and native
counter check: **826,733 cohort ACKs exactly reconcile**, with five measured
errors across the windows. At 2,262/s the median p50/p99 is G5
9.994/20.595 ms, RI 9.929/18.383 ms and G6 10.093/20.972 ms. Median PG
CPU is 244.6/244.2/244.5 µs/ACK respectively. At 800/s G5/RI PG CPU is
660.0/656.7 µs/ACK. No write SLO or PG CPU regression is observed. The
read-index proof is not added to a write's protocol.

The private-family process audit covers pilot, witness, main and diagnostic
ledgers. **Owned PIDs left: none.** The private campaign PG at
`/tmp/s1c-n_78brx0/pg` is retained, stopped, with no postmaster PID file.
Port 55743 is no longer served. All 204 main and six low-rate measurement
starts have passing ready quiet gates; continuous free space stays above
25.5 GiB. To reserve headroom, 908 unchanged tracked historical report
artifacts (2,188,431,479 bytes) are temporarily evicted from this new worktree
and restored from exact local Git blobs before final checks. No report
artifact deletion remains in the diff. No old SPR release/fixture or other
worktree's artifact is removed. `/home` free after restoration: about
**24.2 GiB**. No push, origin fetch, stash, Git configuration mutation,
credential copy or 450b access occurs.

[Custody, disk, process and digest receipt](./round2-evidence.json).
The implementation removes the scarce-worker wait and qualifies strict
above-pin local rungs without a freshness clock premise. Default-on promotion,
Stage R/E integration and packed publication remain outside this result.

Final post-document checks pass: `./ref-check` (575 LLPs, 12,176 refs,
zero errors/unchecked), whitespace, Python syntax, artifact digests, all 18
exact counter audits and the 32-application-connection cap. The previously
recorded unchanged Snapback 1 inventory failures remain outside this lane.
