# G5: revision-equality read reuse — 2026-10-24

G5 implements the exact revision-equality baseline with **one validation flight
including the first hit**. At 128 pooled clients, W2 changes
**10,396 → 10,838/s** and W3
**5,547 → 10,431/s**. The S1-shaped pinned
split reaches **9,344 W2 / 8,787 W3 reads/s**.
Every final window has zero request errors. The qualified one-flight G5 path
**does not exceed 16k/16k**. Proceed to G6 for that target, or separately qualify
a one-flight method of reusing PG validation plans. This is not a delayed-link,
matched S1 campaign, publication or promotion qualification.

## Rebase and scope

Host: expo-build-450a (Tailscale 100.84.186.119; OS hostname
`expose-builder-nothing`), worktree `~/projects/sb4-s10a`, branch `sb4-pg/g5`.
The requested `origin/main` fetch resolved to an August tip on this host's SSH
relay. The resulting ancient-base rebase was aborted without retaining its
changes. The relay's October `origin/sb4-pg/main-mirror` contains the requested
PIPE and write stack through **115be62c28**; that exact tip is the integration
base. JOURNAL conflicts retain both sides and the RFC Revised entries are
merged. The five RCPU commits become:

| Original | Rebased |
|---|---|
| b95cd5a4d7 | 53ecea82de |
| 841fc23a51 | ed75afcf42 |
| dee128cf53 | ff2b4ba4d2 |
| f79592c918 | 60f41c26d6 |
| 3bce649288 | **605a0f1422** |

Before starting G5, the rebased build passes, full default core reports
**1,170 passed / 0 failed / 5 ignored across 49 targets**, and the full binary
reports **588 passed / 0 failed / 49 ignored**. No rebase repair commit is
needed. The unchanged rebased release binary is the paired before arm.

## Implemented baseline

[The governing RFC](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md)
§4 and §6 G5 govern this change. `_head.revision` is an additive internal
Postgres counter under the existing serialized head fence. Successful members,
including receipt-only members, advance it in their physical transaction.
A group advances by completed-member count; rollback removes aborted members.
Solo durable family writers join the same revision domain. Ownership lease
traffic remains the explicit exception. There is no second durable commit order.

[The cache](../../crates/snapback4-core/src/engine/revision_cache.rs) retains
immutable ordinary-snapshot revision, head, identity, code and result. A hit
uses one statement carrying current revision, identity/code and fresh authority
facts. Parse/Bind/Execute/Sync share a flight even on first use; no cold named
PREPARE may add a request flight. Exact equality and the existing Rust authority resolver with a fresh
service clock authorize reuse. Mismatches execute the ordinary query snapshot;
there is no promotion, publication gate, footprint certification or grant.
The selected statement is the hit's read point. No PG data scan, row-image
decoding or query interpretation occurs on a hit.

The key covers store/generation/code/native identity, canonical typed arguments,
operation, principal, credential digest/kind, delivery mode, provenance and read
ceilings. Canonicalization uses a copy, preserving ordinary alias refusals.
Opening/activation metadata includes the stored native digest, including an
explicit empty marker; local development and release adoption retire the cache
epoch. Raw bearer tokens and authority facts are not retained in cache keys or
counter logs. HTTP request admission, worker permits and response construction
remain on the ordinary route. Logical meters and complete outcome/cursor,
sequence, generation and store identity semantics remain unchanged.

Time-dependent programs, lifetime schemas, presence/ephemeral reads, native
work, retained search, structured internal arguments and nonempty delivery
bindings bypass reuse. Internal row/map arguments can carry metadata absent
from their serde identity. Hidden delivery backing is refused by retention
accounting. SQLite reuse is explicitly disabled: it has no complete durable
revision stream. SQLite still supplies the ordinary outcome/meter oracle.
Existing Postgres profile exclusions remain in force, including timed
publication, native/jobs/actions/schedules and assets. Their concrete fenced
family-write paths are revision-tested without enabling those public surfaces.

The cache uses two-touch admission and eviction, at most 32,768 entries and
probation keys, 128 entries per principal, 32 outstanding fills and 512 KiB
charged per entry. Defaults cap charged retention at **448 MiB/store** and
**512 MiB/process**, including conservative payload/backing estimates,
bookkeeping and outstanding reservations. These are cache retention budgets,
not a bound on total process RSS or ordinary response serialization. Shared
payload reservations follow both fill and hit responses beyond directory
removal and engine drop. Actual retained provenance is charged separately from
the unbuilt transport-mask allowance. The unrestricted final cache retains
10,337 entries with a peak charged footprint of
393.7 MiB and 0 evictions;
the pinned arm retains 8,447 entries, with a peak
of 385.7 MiB. Operator-local aggregate
counters contain no keys, credentials, results or authority facts.

## Witnesses and failing-before evidence

The 15 tests in [revision_cache_tests.rs](../../crates/snapback4-core/src/engine/revision_cache_tests.rs)
pass against private PG16, including two independent memory witnesses:

| Witness area | Evidence |
|---|---|
| Hit semantics and RT0 | Full and read-only credentials, W1/W2/W3, cached versus uncached PG versus SQLite; full outcomes, logical meters, manifests and cursors compare equal; actual hit counter advances and each hit is one PG flight. |
| Complete revisions | Program/Engine/Publication/Direct members; receipt-only operations; worker markers/families, claim admission/leases, clock pins, assets/release, principal generations; actual session mint/rotate/revoke; changed data yields changed result. |
| Group atomicity | Two completed receipt-only members and one rolled-back member publish exactly two revisions with their receipts; another reader sees neither private change before physical COMMIT. |
| Fresh authority | Revocation, expiry, kind/scope, duplicate credential records, principal generation, read cap, supervisor revision and worker-family changes between fill and hit refuse or miss. Clock-only expiry refuses without a durable commit. |
| Failed revision advance | A trigger suppressing only the revision update causes the solo family transaction to refuse and roll back its data before COMMIT; the original revision and cached result remain valid. |
| Coherent fill | A durable commit inside the fill's authority callback cannot relabel the earlier snapshot result with the later revision. |
| Ownership/code | Administrative activation, changed program generation, empty/nonempty native markers, both local adoption paths and foreign ownership takeover. Recorded tagged backend identities precede product takeover termination. Lease renewal itself does not advance application revision. |
| Maintains and lifetimes | Real maintained data changes invalidate W3. Physical expiry advances revision and public seq. A pure control actually hits while now, presence and ephemeral programs independently bypass; ephemeral mutations change answers. Timed publication stays refused by the existing profile. |
| Memory | Entry/byte/principal/fill/process caps, eviction, two-touch one-shot protection, oversized values and provenance, and references surviving eviction/cache drop until the last fill/hit response releases them. |
| Encoding and key separation | NUL digests refuse before SQL; NUL/unicode image parity; SQL_ASCII reader validation refuses before decoding facts/results; arguments, viewer, credential, mode, provenance, ceilings and retained/custom-kind exclusions stay distinct. |
| Refused arguments | Supplying both an alias and its canonical name returns the same authorized E_INPUT with reuse enabled or disabled. |

Five temporary negative controls produced runtime failures, not compilation
failures. Each failed **0 passed / 1 failed**, exit 101, and was restored:

| Removed behavior | Failure observed |
|---|---|
| Reuse disabled | Hit witness observes zero hits instead of one. |
| Revision updates suppressed | Interleaved-commit witness receives the stale body. |
| Encoding guard bypassed | SQL_ASCII reader reuses a result instead of refusing. |
| Argument planning mutates original inputs | Ambiguous alias request succeeds instead of ordinary E_INPUT. |
| Deployed code identity uses native=None | A release with a stored native marker never fills/hits. |

The final positive rerun passes all 15. Separately, the initial HTTP RT0
qualification failed 1 passed / 1 failed because the first named validation
PREPARE made warm repetitions disagree (1 versus 2 flights). Typed one-flight
validation fixes it without changing either ratchet table. The direct witness
now counts the first admitted hit, rather than hiding preparation in warmup. Raw controls, logs and PID receipts
remain under `/tmp/sb4-g5`; none are committed.

## Measurement method

This repeats the [RCPU harness](../20261024-rcpu/REPORT.md): unchanged release
`sb4-scale-controls load --closed-loop --target snapback`, the retained million
message/1,024-room/256-principal fixture and 256 real account tokens. HTTP is
loopback TCP; PG16 uses its private Unix socket on port 55461. PG has 400 maximum
connections, 512 MiB shared buffers and ordinary durable settings. Shared PG17
on port 55440 is untouched. Each cell uses 1 s warmup and 5 s measured time,
64/128/256 pooled clients; programs run W1, W2, W3 at each population. Each arm
starts a fresh serving process. The cache persists between cells within an arm.

All measured product binaries use `cargo build --release -j 8`; dev/test debug
info is line tables only and the worktree owns its target directory. The reader
pool/depth and serving worker configuration remain RCPU's 30 physical readers,
PIPE depth 4 and 30 executing request workers. No owned build/test runs during
a measurement window. Before every window, 15 quiet seconds below 0.5 competing
user CPU core are sought; continuous contention is bounded at 30 minutes.
No final window reaches that deadline. Competing work resumes during some
windows; measured interval averages remain below the user's two-core limit.
One-minute load is recorded immediately before/after every CPU window below.
High load averages can retain earlier builds after interval CPU becomes quiet.

CPU/read uses successful completions inside the common CPU window. Server
and client counters bind PID start ticks; PG counters include the owned tree
and reaped children. No counter is invalid. Latencies describe successful
arrivals. Cache hit percentages use differences of aggregate 250 ms samples
bracketing approximately the same window (at most 250 ms endpoint skew), so are
approximate physical reuse rates. Lock-contention bypasses and admission/cold
fills remain misses. The first W2 window includes initial population of 8,192
keys. Before-arm hit rate is zero. W1's rotating point workload largely fails
two-touch admission in these short windows; its additional key/facts work is a
cost, visible in CPU/read and the pinned throughput decline.

Measured binary SHA-256:

- Before: `6034785d4882b365916cd62e5c8c0a8945112f55bc3eaa4b5df02e0a383bc5cb`.
- G5: `c5de2ed923464783fc6103d151b38be3f65ad17b7cc124a28b5fce97beb25395`.

The measured release uses the final implementation source.

## Release results

CPU columns are **server / PG / client microseconds per read**. Load is the
one-minute average before → after. Other CPU is the interval competing-user
core average.

| Arm | Clients | Query | Reads/s | p50/p99 ms | CPU µs/read | Hit % | Load | Other CPU |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| before | 64 | W1 | 15,561 | 3.81/9.43 | 262.6/255.9/66.3 | 0.00 | 5.42 → 5.79 | 0.59 |
| before | 64 | W2 | 11,193 | 5.52/10.59 | 413.8/449.0/110.2 | 0.00 | 4.33 → 6.87 | 0.00 |
| before | 64 | W3 | 5,529 | 11.29/19.50 | 1048.7/837.4/108.2 | 0.00 | 5.30 → 7.60 | 0.00 |
| before | 128 | W1 | 17,887 | 6.91/13.30 | 271.5/242.3/68.8 | 0.00 | 5.44 → 6.45 | 0.06 |
| before | 128 | W2 | 10,396 | 11.82/22.20 | 430.2/456.1/112.4 | 0.00 | 4.33 → 6.71 | 0.15 |
| before | 128 | W3 | 5,547 | 22.81/34.24 | 1053.2/834.7/109.6 | 0.00 | 4.81 → 7.38 | 0.00 |
| before | 256 | W1 | 18,259 | 13.66/27.15 | 275.5/241.9/72.4 | 0.00 | 5.36 → 7.65 | 0.00 |
| before | 256 | W2 | 10,358 | 23.77/48.86 | 432.5/458.0/113.2 | 0.00 | 5.54 → 8.38 | 0.08 |
| before | 256 | W3 | 5,256 | 47.09/81.72 | 1067.3/838.6/114.5 | 0.00 | 4.37 → 7.06 | 0.04 |
| after | 64 | W1 | 17,242 | 3.57/7.20 | 281.8/272.7/67.7 | 0.00 | 6.15 → 8.30 | 0.02 |
| after | 64 | W2 | 10,231 | 6.04/11.65 | 310.8/627.9/112.0 | 72.12 | 6.76 → 8.46 | 0.00 |
| after | 64 | W3 | 10,148 | 6.00/12.80 | 277.9/666.9/102.7 | 97.97 | 6.13 → 8.60 | 0.14 |
| after | 128 | W1 | 17,523 | 7.10/12.90 | 284.8/260.1/69.4 | 0.00 | 5.67 → 6.49 | 0.00 |
| after | 128 | W2 | 10,838 | 11.53/20.09 | 266.7/656.2/113.3 | 95.97 | 4.14 → 7.65 | 0.00 |
| after | 128 | W3 | 10,431 | 11.96/19.73 | 278.6/662.2/106.2 | 98.06 | 8.08 → 9.91 | 0.00 |
| after | 256 | W1 | 17,286 | 14.46/28.69 | 287.1/261.1/72.5 | 0.30 | 2.42 → 5.51 | 0.00 |
| after | 256 | W2 | 10,783 | 23.23/47.97 | 267.3/660.9/116.3 | 95.89 | 3.67 → 6.09 | 0.00 |
| after | 256 | W3 | 10,457 | 23.95/45.78 | 279.6/664.4/106.7 | 98.00 | 4.57 → 6.93 | 0.00 |

## One-host split and G6 verdict

Both SMT siblings are pinned: PG on cores 0,1,2,6,7,8 (three physical), server
on 3,4,9,10 (two physical), client on 5,11 (one physical). PG affinities are
restored after every arm. The pinned runs use 128 pooled clients.

| Arm | Clients | Query | Reads/s | p50/p99 ms | CPU µs/read | Hit % | Load | Other CPU |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| before-pinned | 128 | W1 | 17,482 | 7.21/10.01 | 225.0/224.8/50.6 | 0.00 | 3.75 → 4.98 | 0.08 |
| before-pinned | 128 | W2 | 10,487 | 12.05/16.15 | 375.3/404.3/78.6 | 0.00 | 3.56 → 5.60 | 0.07 |
| before-pinned | 128 | W3 | 3,820 | 33.03/46.60 | 1031.3/776.9/113.6 | 0.00 | 3.59 → 6.98 | 0.53 |
| after-pinned | 128 | W1 | 16,357 | 7.74/9.90 | 241.7/237.7/50.6 | 0.00 | 3.63 → 6.14 | 0.00 |
| after-pinned | 128 | W2 | 9,344 | 14.06/15.80 | 245.9/629.5/83.7 | 73.48 | 7.36 → 9.41 | 0.00 |
| after-pinned | 128 | W3 | 8,787 | 14.51/16.70 | 211.2/681.4/81.0 | 99.00 | 9.30 → 11.28 | 0.00 |

Using `min(4/server_CPU, 6/PG_CPU, 2/client_CPU)` gives optimistic logical-thread
ceilings for this split; physical-core/SMT efficiency, transport waits and
serialization prevent treating them as capacity qualifications:

| CPU basis | W1 ceiling/s | W2 ceiling/s | W3 ceiling/s |
|---|---:|---:|---:|
| before C128 | 14,734 | 9,299 | 3,798 |
| after C128 | 14,047 | 9,143 | 9,060 |
| before-pinned C128 | 17,775 | 10,658 | 3,879 |
| after-pinned C128 | 16,547 | 9,531 | 8,805 |

The before CPU projection reproduces the stated approximately 9k W2 / 4k W3
limit. The final unrestricted projection is **9,143 W2 /
9,060 W3/s**, and pinned CPU projects
**9,531 / 8,805/s**. The qualified baseline
cannot exceed both 16k targets on this split. **G6 is needed on the currently
qualified path.** No zero-flight grant or G6 capability is implemented here.

The prepared-validation pilot below exceeded 16k for both, but failed the
first-hit flight contract. Its lower PG CPU/read strongly suggests repeated
statement planning/setup is the remaining cost; this is an inference from the
paired transport contrast, not a new stack profile. It does not prove G6 is
the only possible architecture: a separately qualified one-flight reusable-plan
mechanism could change the decision. The delayed-link matched campaign remains
unmeasured. G6 also needs its own ownership/clock protocol; these numbers cannot
qualify that protocol.

All windows are read-only against a stable seed. Every durable commit invalidates
revision equality, so mixed write traffic can materially reduce these hit rates;
this result makes no mixed-workload or promotion claim.

## Pilots retained

The first deployed pilot completed seven cells with zero hits. Its immutable
code identity used native=None while the release persisted an explicit empty
native marker. It failed closed, then was corrected with the native-marker and
local-activation regression above. Those cells are retained below and excluded
from the final G5 improvement comparison. Its next window was interrupted
before completion; the owned serving process was stopped and confirmed.

| Arm | Clients | Query | Reads/s | p50/p99 ms | CPU µs/read | Hit % | Load | Other CPU |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| pilot-no-fill | 64 | W1 | 17,450 | 3.54/7.06 | 280.7/272.2/67.0 | 0.00 | 3.95 → 6.91 | 0.00 |
| pilot-no-fill | 64 | W2 | 10,752 | 5.77/10.72 | 439.9/472.3/110.3 | 0.00 | 7.51 → 8.75 | 0.00 |
| pilot-no-fill | 64 | W3 | 5,427 | 11.53/19.14 | 1075.8/859.4/107.2 | 0.00 | 6.81 → 9.15 | 0.00 |
| pilot-no-fill | 128 | W1 | 17,464 | 7.17/11.96 | 287.8/260.7/70.4 | 0.00 | 6.55 → 8.91 | 0.00 |
| pilot-no-fill | 128 | W2 | 10,629 | 11.82/18.91 | 450.6/474.4/112.9 | 0.00 | 6.45 → 8.90 | 0.00 |
| pilot-no-fill | 128 | W3 | 5,412 | 23.27/37.06 | 1078.7/857.0/109.4 | 0.00 | 6.37 → 8.82 | 0.00 |
| pilot-no-fill | 256 | W1 | 17,389 | 14.43/27.64 | 291.3/261.8/73.4 | 0.00 | 6.38 → 8.19 | 0.00 |

The next pilot used cached named validation statements. Its final 128-client
unrestricted W2/W3 reached 21,839/20,623 reads/s, and the pinned split
18,219/17,673. That apparent success is **not the final G5 result**: cold PREPARE
adds a second flight on the first cache hit and fails unchanged RT0. Replacing
it with typed one-flight validation increases PG CPU/read substantially. The
complete named-preparation contrast is retained here:

| Arm | Clients | Query | Reads/s | p50/p99 ms | CPU µs/read | Hit % | Load | Other CPU |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| prepared-pilot | 64 | W1 | 16,973 | 3.62/7.44 | 281.4/278.9/67.2 | 0.00 | 4.15 → 5.66 | 0.04 |
| prepared-pilot | 64 | W2 | 16,471 | 3.37/12.75 | 242.5/171.2/99.4 | 82.76 | 4.05 → 6.21 | 0.70 |
| prepared-pilot | 64 | W3 | 20,738 | 2.89/6.97 | 235.2/130.8/98.4 | 96.87 | 9.68 → 10.03 | 0.00 |
| prepared-pilot | 128 | W1 | 17,247 | 7.18/14.20 | 281.6/254.1/68.0 | 0.00 | 7.31 → 10.81 | 0.00 |
| prepared-pilot | 128 | W2 | 21,839 | 5.69/11.60 | 221.7/136.5/104.6 | 93.50 | 7.81 → 9.11 | 0.00 |
| prepared-pilot | 128 | W3 | 20,623 | 5.97/11.99 | 239.3/137.3/96.2 | 96.35 | 6.52 → 6.72 | 0.00 |
| prepared-pilot | 256 | W1 | 17,509 | 14.33/27.00 | 286.6/259.4/72.5 | 0.39 | 4.89 → 8.34 | 0.00 |
| prepared-pilot | 256 | W2 | 21,353 | 11.65/24.10 | 221.5/137.8/104.6 | 93.65 | 5.50 → 6.82 | 0.00 |
| prepared-pilot | 256 | W3 | 20,470 | 12.13/24.51 | 243.1/137.6/99.6 | 96.47 | 4.88 → 6.65 | 0.00 |
| prepared-pilot-pinned | 128 | W1 | 16,182 | 7.80/11.18 | 243.7/238.9/51.9 | 0.00 | 3.53 → 5.57 | 0.04 |
| prepared-pilot-pinned | 128 | W2 | 18,219 | 6.47/13.42 | 213.3/141.4/95.1 | 81.27 | 4.05 → 6.37 | 0.00 |
| prepared-pilot-pinned | 128 | W3 | 17,673 | 6.80/13.33 | 215.6/114.8/82.4 | 96.01 | 4.56 → 6.20 | 0.00 |

A separate 128 MiB capacity pilot, before the final bounded budget and retained
metadata accounting, shows why capacity admission needs measurement. W2's
repeated set does not fit: 1,462 retained entries, 12,471 evictions, 1.84% hits,
and 10,535/s. The final working set fits without eviction. The smaller pilot
is retained, not selected as the after result.

| Arm | Clients | Query | Reads/s | p50/p99 ms | CPU µs/read | Hit % | Load | Other CPU |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| capacity-128 | 64 | W2 | 10,535 | 5.89/10.76 | 452.8/474.8/110.1 | 1.84 | 1.25 → 4.03 | 0.00 |

One initial final-arm W2/C256 window overlapped the start of the owned core
check after the load gate had resumed. That window is excluded, archived with
an `overlap-` prefix, and repeated on the same warm serving process after the
core job exits while the other measurement windows remain held. Its CPU/read
and rate do not enter any final table or projection. All final measurement
windows have no owned build/test overlap.

## Checks

| Check | Passed | Failed | Ignored | Result |
|---|---:|---:|---:|---|
| Build (`cargo build -p snapback4 -j 8`) | — | 0 | — | Pass |
| Full default core, 49 targets | 1,170 | 0 | 5 | Pass |
| Full `snapback4` binary | 588 | 0 | 49 | Pass |
| Both unchanged HTTP RT0 ratchets | 2 | 0 | 0 | PG W1/W2/W3 1/1/1; SQLite 5/5/132 |
| Final G5 cache suite | 15 | 0 | 0 | Full/read-only, first hit, wire/provenance and rollback witnesses |
| Full Postgres script, initial run, 35 Rust targets | 734 | 2 | 0 | See resolution below; public serving witness passes |
| Corrected vector-tail fixture, focused rerun | 1 | 0 | 0 | All seven vector-tail columns, group and solo rollback |
| Minimal Postgres feature build (`--no-default-features --features postgres`) | — | 0 | — | Pass |
| Root `./ref-check --verbose` | — | 0 | — | 567 LLP docs / 11,901 refs; zero unchecked |

The full script exits 1. Its two failures are the inherited evaluator Serializable
race (`40001`) and the vector-tail fault fixture's old expected message. The latter
suppressed every `_head` update, so the new revision guard correctly refused before
the intended public-tail fault. The fixture now permits updates that leave `seq`
unchanged and still suppresses the public vector-tail update. It additionally
checks that both group failure and solo fallbacks roll back the internal revision.
Its focused rerun passes all seven fault cases. A new positive cache witness also
confirms the existing solo flush checks prevent an unversioned commit if the
revision update is suppressed. No production-code repair is needed.

All 15 cache cases pass together against the final sources. The complete script
was not repeated after this test-only fixture repair; all other stages had passed
with unchanged production code. **The only unresolved red is the inherited
`40001`.** This distinction is deliberate: the 734/2 initial result is not relabeled
as a clean full-script rerun. The public CLI witness passes persistence, real
ownership loss/SIGKILL takeover, revocation, evolution, changes/SDK sync, bootstrap
refusals and maintained totals on PG and SQLite, and confirms its private PG16
cluster stopped. No ratchet table or product assertion is weakened.


## Resource and process custody

Private PG16 master **3263997** (port 55461, retained RCPU fixture) is stopped
with `pg_ctl -m fast -t 180 -w stop`, independently confirmed status 3, no
`postmaster.pid`, and no process. Public-witness master **127396** (port 55483)
is likewise independently confirmed stopped, status 3, no PID file and no process.
Serving processes, harness clients and owned helper jobs are gone. The final
PID/start-tick audit is empty: **no recorded PIDs remain**. Only recorded identities
were signaled; shared PG17 on 55440 and q24 files were untouched.

All observed disk readings stay above the 40 GiB floor. The automated minimum is
41.85 GiB (an earlier manual observation was about 41.6 GiB). Only this worktree's
inactive target artifacts were reclaimed. Raw logs, temporary programs, profiles,
receipts and complete counter samples are outside the repository under
`/tmp/sb4-g5`. Commits use the requested author/committer and remain local; no push
or Git configuration change is performed.
