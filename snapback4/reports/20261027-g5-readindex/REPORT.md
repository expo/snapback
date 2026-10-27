# G5R: clock-free coalesced validation

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
