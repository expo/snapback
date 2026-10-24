# G6: zero-flight revision hits under a bounded read grant

G6 hits make **zero PG flights**. Under the S1-shaped pinned split, W2/W3
reach **18,887/20,797 reads/s**, both above 16k, versus paired G5
9,330/8,764. The 1% unrelated-write diagnostic falls to 5,095 W3 reads/s
with 92.3% misses; exact revision equality retains its false-miss cost.
All 25 measured windows have zero request errors.

Lane `sb4-pg/g6`, base **af342f8ef16215a44d8de2f5c4bc7755da341fa5**,
worktree `~/projects/sb4-s10a` on expo-build-450a (OS hostname
`expose-builder-nothing`, Tailscale 100.84.186.119). Commits remain local.
This is loopback capacity and protocol evidence, conditional on the declared
clock bounds. It is not delayed-link S1, failover, publication or promotion
qualification.

## Protocol and scope

[The Accepted RFC](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md)
§4.1–§4.5 governs this implementation. The existing `_head.revision` remains
the durable completed-member order. There is no cross-revision promotion.
A G6 entry's immutable fill revision must equal the locally published revision,
including its public head, store identity, generation and schema/code identity.

[The grant](../../crates/snapback4-core/src/engine/postgres/read_grant.rs)
is backed by `_read_grant(store_id,holder,token,epoch,valid_until)` on the
reserved lease connection. Startup may install it only before opening an owned
handle. Handles and detached readers share the publication barrier. Every
current takeover, including a process without G6 enabled, takes the conflicting
owner claim before checking the outstanding grant and before any termination or
replacement. Renewal locks the owner first, then extends the exact grant tuple;
a shorter writer lease cannot shorten the read barrier. Graceful release first
revokes/drains local cache reads, then shortens the exact persisted epoch.

Zero-flight reuse is **opt-in**, with
`SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms`. The measurement
setting `1000,250` declares that database time advances no faster than
`1.001 * CLOCK_BOOTTIME_elapsed + 250 ms` over a grant. The three-second
persisted grant therefore gets a local deadline below 2.747 s, rounded down
with another millisecond of margin. Linux `CLOCK_BOOTTIME` includes suspend;
a safe rustix interface preserves the core's unsafe-code prohibition. The
bounds are deployment assumptions, not conclusions inferred from test timing
or an empirical 50 ms margin. Unset stays on G5; an invalid or unsupported explicit setting refuses startup.
Operators must leave it unset for mixed old writer versions and unqualified
failover. This private `ha=none` campaign
qualifies no arbitrary wall-clock steps or HA clock behavior.

Under one gate read, a candidate verifies its live grant and exact epoch,
compares the complete published stamp, and calls the existing request authority
resolver on facts retained from that same fill revision, with a fresh service
clock. It synchronously rechecks the grant after the authority callback too.
Expiry, kind, scope, captured principal generation, supervisor markers and
duplicate-credential policy remain shared with ordinary reads. No cached allow
bit authorizes a request. The synthetic callback snapshot has no pending SQL;
ordinary storage access through it refuses. Full and read-only credentials keep
their distinct delivery semantics.

The physical committer captures the transaction's resulting identity/revision/
head with an additional in-transaction publication query on grant-enabled writes,
closes the gate before dispatching COMMIT, and publishes only after a confirmed
outcome. The mixed CPU/read includes this write-path overhead. Known rollback reopens the old publication. A refusal before dispatch rolls
back the already-admitted transaction and releases its first-lock fence. Unknown COMMIT
keeps the gate logically closed, retires cached reuse and pauses new writer
transactions and queue execution/admission. Recovery requires fenced
reacquisition and a fresh process/cache epoch; there is no in-process reopening
on old evidence. Renewal uses atomic deadline state independently of the
publication lock, so a long flush cannot park the reserved lease connection.
Candidate gate waits are bounded to one second, then use fresh database
validation. Ordinary misses capture a possible fill epoch without waiting.

Grant loss, expiry or reconnect retires the zero-flight epoch; the existing G5
statement/ordinary snapshot remains the fallback. G5 still resolves fresh facts
from one statement. An observed local revision mismatch goes straight to the
ordinary coherent miss. Fills retain their original revision even when another
commit happens during execution.

[The cache](../../crates/snapback4-core/src/engine/revision_cache.rs) keeps
G5's two-touch admission, per-principal/entry/fill limits and 448 MiB/store,
512 MiB/process retention budgets. Retained authority facts and pre-encoded
Plain JSON data are charged too. The temporary JSON encoder is bounded by the
already-held fill reservation, including worst-case escaping. Reservations
follow shared fill/hit responses beyond eviction. This bounds cache retention,
not total process RSS or ordinary response buffers.

HTTP reuses that exact data encoding while retaining ordinary request parsing,
worker permits, admission/body deadlines, response framing, headers, logical
meters and output ceilings. It still builds current envelope metadata.
Queries return `seq` at the captured head, generation and store identity; no
query-body `head` is invented. Time/lifetime, ephemeral/presence, native, retained
search, structured internal arguments and nonempty delivery exclusions remain.
SQLite stays on ordinary execution and supplies the outcome/meter oracle.

## Witnesses and negative controls

[The G6 cases](../../crates/snapback4-core/src/engine/revision_cache_grant_tests.rs)
cover first-hit zero flights for W1/W2/W3 and full/read scope; complete outcome,
cursor, manifest, encoded data, logical meter and metadata parity with ordinary
Postgres and SQLite; revocation, scope/kind/duplicate changes, principal generation,
cap/session expiry, supervisor and family changes; clock-only expiry; unrelated
and receipt-only commits; activation, store/generation identity and maintained
data; real foreign takeover, including a parked reader with no intervening old-owner
request before the successor commits revocation; renewal versus claim; late renewal; acknowledged
release/drain; known rollback; real COMMIT stalls; durable-but-unknown COMMIT;
paused writers; startup-only activation; bounded escaping; and nonblocking misses.
The inherited G5 suite retains complete producer/group/coherent-fill, encoding,
eligibility and retention witnesses.

The HTTP witness exercises the complete dispatcher and checks the first admitted
G6 hit, complete response equality and one-flight fallback after grant revocation.
The existing Postgres and SQLite ratchet tables are unchanged. Cold ordinary
reads retain preparation cost; it is not hidden in the G6 first-hit count.

Seven temporary negative controls compile and then fail at runtime. Every one
reports **0 passed / 1 failed**, exit 101, and is restored:

| Removed protection | Runtime failure |
|---|---|
| G6 reuse | First G6 hit makes one PG flight instead of zero. |
| Published revision equality | A session deleted after a real G6 hit reuses the old answer. |
| Synchronous grant deadline | A parked old reader serves revoked authority after the successor commits, with no intervening old request to revoke its epoch. |
| Persisted foreign grant barrier | A shorter writer lease allows takeover before the read epoch expires. |
| Publication gate | A hit returns while the real deferred COMMIT remains blocked. |
| Sticky unknown-outcome closure | A durable-but-unknown COMMIT reports the gate open. |
| Fresh authority-clock policy | Clock-only expiry succeeds using altered retained expiry facts. |

Two qualification pilots remain explicit. A 500 ms test grant correctly refused
late startup under competing load; the timing witness now uses the production
three-second lease. The first new HTTP witness incorrectly expected a cold miss
to have no preparation flight; it was corrected to retain the existing cold
count. Neither changes an existing product assertion or ratchet table. The first gate-control variant also skipped publication
installation and failed at initial reuse; the final control preserves installation
and fails specifically at the real COMMIT gap. The initial Postgres invocation
was stopped after its standalone evaluator refused the new dependency under
`--locked`; evaluator and seed lockfiles now pass locked verification. A later invocation
was interrupted to add the pre-dispatch rollback witness/fix; only the final
complete invocation supplies the reported script verdict. Its non-timing stale-token
fixture failed because a 300 ms unrenewed lease expired during cold setup. That
fixture now uses 30 seconds and still requires explicit release for handoff; the
complete affected ownership suite then passes 25/0. Actual timed lease tests retain
their original bounds. The complete script is not relabeled as a clean rerun. Raw logs,
control edits, PID receipts and complete samples remain under `/tmp/sb4-g6`.

## Measurement method

Release-only builds use the owned `snapback4/target`, eight Cargo jobs and
line-tables-only debug information. Incremental compilation is disabled after
the disk guard's stop/reclaim event. There is no `--workspace --all-targets`
invocation. The serving executable is copied before measurement so no rebuild
can change its inode beneath a live server.

The existing RCPU/S1 harness uses loopback TCP, pooled reqwest, one outstanding
request/client, 64/128/256 clients, one second warm-up and five-second common CPU
windows. The retained million-message, 1,024 ordinary-room, 256-principal fixture
and real account credentials are unchanged. Private PG16 is socket-only on
55461, with the same durable settings, 400 maximum connections, 512 MiB shared
buffers, 30 physical readers and PIPE depth four. There are 30 executing short
workers. Cache state persists across cells of one arm; each arm starts a fresh
serving process. G5 comparisons use the original final G5 release executable.

The pinned split assigns both SMT siblings: PG **0,1,2,6,7,8**, server
**3,4,9,10**, client **5,11**: three/two/one physical cores, respectively.
PG affinity is restored after each arm. The read-only cells have no application
writes. The mixed diagnostic replaces one arrival in 100 per worker with the
unchanged W4 increment, using the existing operation/response validator; the
remaining read schedule is unchanged. It measures unrelated-write false misses,
not message insertion or maintained-total write cost. Read and write completions
and latency histograms are recorded separately.

Before every window, the runner seeks 15 continuous seconds below 0.5 competing
CPU core, with a 30-minute continuous-contention bound. It records one-minute
load immediately before/after each common CPU window and interval competing CPU.
The gate accounts for user/system/interrupt CPU after subtracting owned process
trees. No owned build or test overlaps a measurement window.

Server CPU covers the complete serving process; PG covers the owned live/reaped
process tree; client covers the load generator. Counters bind PID start ticks.
CPU/read uses successful read completions inside the common CPU window; mixed
CPU/read includes the accompanying write cost. Cache and gate rates use 250 ms
aggregate samples selected at or before each CPU boundary, with endpoint skew
disclosed. Gate-closed fraction excludes time merely waiting for existing gate
readers. Candidate stall includes a wait that becomes a revision miss after
COMMIT; successful-G6-hit stall is reported separately. Exact equality means a
successful local COMMIT necessarily turns such an old candidate into a miss.

## Release results

**Both pinned W2 and W3 exceed 16,000 reads/s.** G6 reaches **18,887 W2 /
20,797 W3**, versus paired G5 **9,330 / 8,764**: 2.02× / 2.37×. Pinned
server CPU/read falls **244.4 → 187.1 µs** for W2 and **211.1 → 178.5 µs**
for W3; PG CPU/read falls **630.0 → 101.2 µs** and **682.1 → 56.1 µs**.
Those averages include misses and lease renewal. Individual admitted G6 hits
make zero PG flights. This clears the natural 16k bars in this loopback capacity
diagnostic; it is not a matched delayed-link S1 result.

At unrestricted C128, W2/W3 rise **10,786/10,672 → 27,347/27,757 reads/s**.
Server CPU/read falls **267.2/277.0 → 187.0/188.1 µs**, and PG CPU/read falls
**656.6/660.6 → 68.6/24.0 µs**. W1 remains predominantly ordinary misses:
C128 is essentially unchanged, and C256 drops from 17,276 to 16,380/s. No general
W1 improvement is claimed. Every final window has zero request errors.

### Unrestricted loopback

| Arm | Clients | Workload | Reads/s | p50/p99 ms | CPU server/PG/client µs/read | G6/G5/miss % | Load before → after | Other CPU cores |
|---|---:|---|---:|---:|---:|---:|---|---:|
| g5 | 64 | W1 | 17,390 | 3.54/7.17 | 281.2/271.7/66.8 | 0.00/0.00/100.00 | 3.70 → 5.64 | 0.00 |
| g5 | 64 | W2 | 10,624 | 5.80/11.26 | 296.3/641.4/111.1 | 0.00/76.40/23.60 | 4.04 → 6.84 | 0.00 |
| g5 | 64 | W3 | 10,385 | 5.92/11.78 | 276.5/665.0/103.8 | 0.00/98.04/1.96 | 8.70 → 11.05 | 0.03 |
| g5 | 128 | W1 | 16,979 | 7.33/13.19 | 287.2/278.4/70.4 | 0.00/0.00/100.00 | 8.60 → 11.11 | 0.02 |
| g5 | 128 | W2 | 10,786 | 11.59/19.99 | 267.2/656.6/115.9 | 0.00/95.93/4.07 | 7.96 → 10.52 | 0.00 |
| g5 | 128 | W3 | 10,672 | 11.71/20.10 | 277.0/660.6/105.1 | 0.00/98.23/1.77 | 7.62 → 7.73 | 0.00 |
| g5 | 256 | W1 | 17,276 | 14.48/27.54 | 289.0/267.2/74.0 | 0.00/0.34/99.66 | 5.60 → 7.39 | 0.00 |
| g5 | 256 | W2 | 10,577 | 23.51/48.04 | 267.6/659.2/118.2 | 0.00/96.41/3.59 | 5.36 → 7.49 | 0.00 |
| g5 | 256 | W3 | 10,481 | 23.86/49.35 | 279.7/660.2/109.3 | 0.00/98.06/1.94 | 9.01 → 11.17 | 0.00 |
| g6 | 64 | W1 | 17,628 | 3.50/7.04 | 275.9/267.8/67.8 | 0.00/0.00/100.00 | 4.63 → 6.26 | 0.00 |
| g6 | 64 | W2 | 26,609 | 2.09/7.09 | 189.8/81.5/100.1 | 80.96/0.00/19.04 | 4.56 → 6.60 | 0.00 |
| g6 | 64 | W3 | 28,662 | 2.08/5.20 | 183.5/27.0/100.8 | 96.67/0.00/3.33 | 4.80 → 6.66 | 0.00 |
| g6 | 128 | W1 | 16,973 | 7.38/12.49 | 293.8/269.7/71.2 | 0.00/0.00/100.00 | 4.85 → 7.58 | 0.00 |
| g6 | 128 | W2 | 27,347 | 4.42/10.50 | 187.0/68.6/101.6 | 84.44/0.00/15.56 | 5.43 → 7.00 | 0.00 |
| g6 | 128 | W3 | 27,757 | 4.43/8.56 | 188.1/24.0/102.1 | 97.04/0.00/2.96 | 5.01 → 6.21 | 0.00 |
| g6 | 256 | W1 | 16,380 | 15.23/29.02 | 302.4/271.2/73.4 | 0.00/0.00/100.00 | 5.16 → 7.55 | 0.05 |
| g6 | 256 | W2 | 26,964 | 8.91/23.36 | 189.9/63.3/105.1 | 85.68/0.00/14.32 | 5.88 → 6.05 | 0.00 |
| g6 | 256 | W3 | 27,665 | 9.06/13.30 | 189.9/21.8/103.7 | 97.30/0.00/2.70 | 4.40 → 6.21 | 0.00 |

### S1-shaped pinned split

These use 128 clients and both SMT siblings on the specified three/two/one
physical-core allocation. PG affinity is restored to all 12 hardware threads
after each arm.

| Arm | Clients | Workload | Reads/s | p50/p99 ms | CPU server/PG/client µs/read | G6/G5/miss % | Load before → after | Other CPU cores |
|---|---:|---|---:|---:|---:|---:|---|---:|
| g5-pinned | 128 | W1 | 16,346 | 7.74/9.75 | 241.6/242.1/51.8 | 0.00/0.00/100.00 | 8.89 → 10.18 | 0.00 |
| g5-pinned | 128 | W2 | 9,330 | 14.06/17.07 | 244.4/630.0/84.5 | 0.00/73.92/26.08 | 7.93 → 9.85 | 0.11 |
| g5-pinned | 128 | W3 | 8,764 | 14.53/17.92 | 211.1/682.1/81.9 | 0.00/99.04/0.96 | 7.21 → 9.03 | 0.03 |
| g6-pinned | 128 | W1 | 16,542 | 7.64/9.76 | 238.5/247.5/50.9 | 0.00/0.00/100.00 | 3.44 → 6.05 | 0.00 |
| g6-pinned | 128 | W2 | 18,887 | 6.31/14.73 | 187.1/101.2/95.8 | 78.06/0.00/21.94 | 4.33 → 4.78 | 0.07 |
| g6-pinned | 128 | W3 | 20,797 | 5.46/16.88 | 178.5/56.1/86.3 | 95.40/0.00/4.60 | 3.55 → 5.27 | 0.01 |

### Mixed diagnostic and gate cost

| Arm | Clients | Workload | Reads/s | p50/p99 ms | CPU server/PG/client µs/read | G6/G5/miss % | Load before → after | Other CPU cores |
|---|---:|---|---:|---:|---:|---:|---|---:|
| g6 | 128 | W3 + 1% W4 | 5,095 | 24.77/37.13 | 1149.0/846.7/114.2 | 7.16/0.52/92.32 | 4.45 → 6.25 | 0.06 |

The common five-second mixed window completes **25,474 reads and 258 writes**:
**5,094.8 reads/s and 51.6 writes/s**, with writes at **1.003%** of completions.
The measured-arrival write rate is 51.0/s; write p50/p99 is **20.53/40.63 ms**.
W4 increments unrelated counters, leaving W3's maintained totals unchanged.
Relative to read-only C128, read throughput falls **81.6%** and server CPU/read
rises **188.1 → 1,149.0 µs**. This includes writes and the extra publication
query, ordinary misses/fills and discarded revision equality; it is not an
isolated measurement of COMMIT blocking alone.

The mixed counter window records **7.16% G6 / 0.52% G5 / 92.32% miss**.
A fill that cannot capture an epoch without waiting may still earn a fresh G5
validation hit. Gate-closed fraction is **16.744%** (840.7 ms in a 5.021 s
counter window). **1,691 candidate waits** total **4.252 s** across threads,
or **166.93 µs per completed read**. No successful G6 hit stalls within the
measured window. A candidate waiting across a revision-changing COMMIT becomes
a miss under this baseline; promotion is deliberately absent.

All 24 read-only windows record **0% gate closed, 0 candidate stall/read and
0 successful-G6-hit stall**. Across the entire unrestricted G6 arm, including
warm-up and quiet periods, **one** successful hit waits **131.859 µs**, the
arm's maximum. The entire pinned G6 arm records no stalled successful hit.
Grant revoked/uncertain remains false throughout every measured G6 window.

### Retention, timing and load validity

G6 preserves the 448 MiB/store and 512 MiB/process caps. Authority facts and
encoded data increase charged retention: unrestricted G5 peaks at **394.24 MiB**
with zero evictions; G6 peaks at **447.993 MiB**, with **11,886** evictions across
the arm. Pinned G5 peaks at **385.75 MiB**, zero evictions; pinned G6 peaks at
**447.978 MiB**, with **2,047** evictions. Thus W2's C128 G6 rate is 84.44%,
versus G5's 95.93%; retained encoding is a CPU/memory tradeoff under the same
budget. The pinned W2/W3 G6 rates are 78.06%/95.40%. No budget is raised to
manufacture the capacity result.

All **25 CPU windows** have valid, unchanged PID/start identities and PG root
identity, and zero request errors. CPU snapshot windows span **4.986–5.013 s**
for nominal five-second completion windows. The selected cache samples lie up to
**249 ms before the CPU-start boundary / 244 ms before the CPU-end boundary**;
rates and gate fractions therefore use an approximate shifted counter window,
not an exact per-request join. The mixed 5.021 s counter window is reported above.

Every window enters after the quiet gate. The longest gate wait is **149.45 s**;
none reaches the 30-minute deadline. Other/unassigned CPU during final windows
is at most **0.112 core**, below the brief's two-core limit. One-minute load
before/after each CPU window is preserved in the tables, including retained
load from previous work. All builds/tests finish before the first measured arm.
Postgres is **16.15**, private socket-only, with the original durable settings.

The immutable serving executable hashes are:

| Arm | SHA-256 |
|---|---|
| Original final G5 | `c5de2ed923464783fc6103d151b38be3f65ad17b7cc124a28b5fce97beb25395` |
| G6 | `846c2d92861552c0877536d9946624c70af9a5053217f9a7687ae7e59a45cbad` |


## Qualification

Counts below describe actual completed commands; subprocess helper summaries
are counted once per Cargo target.

| Check | Passed | Failed | Ignored / scope |
|---|---:|---:|---|
| Build, minimal Postgres feature build | pass | 0 | `--locked`, eight jobs |
| Full default core | 1,170 | 0 | 5 ignored; 49 targets |
| Full `snapback4` binary | 588 | 0 | 50 ignored |
| HTTP RT0, both inherited ratchets plus G6 | 3 | 0 | 0 ignored |
| Final G5/G6 cache suite | 32 | 0 | Private PG16; includes admitted-writer rollback |
| Suspend-aware clock-window unit | 1 | 0 | Linux |
| Mixed-harness schedule/ratio units | 2 | 0 | Original read schedule retained |
| Complete `scripts/test-postgres.sh` Rust targets | 753 | **2** | 35 targets; exit 1 |
| Public Postgres serving milestone within that script | pass | 0 | Includes both-store evolution, changes, bootstrap and maintains |
| Complete affected ownership suite after fixture repair | 25 | 0 | 0 ignored |
| Main/evaluator/seed/commit-path lock verification | pass | 0 | Locked checks or metadata, no unrelated dependency updates |
| Release server and RCPU harness | pass | 0 | Eight jobs; line tables only |
| Seven runtime negative controls | 0 | **7 expected** | Each 0/1, exit 101; restored |
| Root `./ref-check --verbose` | pass | 0 | 567 LLPs, 11,908 refs, 0 unchecked |

The complete script's two failures are the inherited evaluator concurrency
`40001` and the repaired ownership setup timing fixture. The affected ownership
rerun passes all 25 cases. **Only the inherited evaluator `40001` remains
unresolved**; no claim of a zero-exit complete Postgres script is made. The
unchanged remaining script stages are not repeated after the fixture-only repair.

RT0 G6 W1/W2/W3 hits are **0/0/0**, including the first admitted hit.
G5 and ordinary warm misses remain **1/1/1**; the new HTTP case explicitly
retains a cold preparation flight and verifies one-flight fallback and subsequent
G5 reuse after grant revocation. SQLite W1/W2/W3 remains **5/5/132**. Neither
inherited JSON ratchet table changes.

## Resources and process custody

The automated disk guard fires once at **39.9827 GiB** during a core build.
Owned build processes are stopped and their descendants confirmed gone before
removing this worktree's inactive debug artifacts. The build resumes with
incremental compilation disabled and later passes in full. Other reclaimed
artifacts are this worktree's inactive incremental/obsolete outputs, completed
default-core test executables and completed evaluator target; no foreign target
is removed. No measured window runs below the floor.

Private PG16 master **312515** (socket 55461, retained data
`/tmp/sb4-rcpu/data`) is stopped with its recorded identity and independently
confirmed: stop exit 0, `pg_ctl status` 3, no pidfile and no process. Public
witness PG16 master **789152** (socket 55483, retained data under
`/tmp/s10d3-serve-7v64kk7y`) is also independently confirmed stopped with status 3,
no pidfile and no process. The final audit of recorded PID/start
identities finds **zero active processes and zero zombies**. No PIDs remain.
The shared PG17/55440 cluster and `~/q24` are untouched. No stash, Git config
change or push occurs. Raw logs, credentials, samples, negative-control edits
and receipts remain outside the repository under `/tmp/sb4-g6` and the private
fixture directories; only this aggregate report is committed.
