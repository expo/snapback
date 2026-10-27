# BCTL — preserve batch drain capacity

Local relative diagnostic on expo-build-1000 (`expose-builder-pixel`), a shared
96-logical-CPU host. These are paired observations, not authoritative capacity
or publication qualification. The authoritative expo-build-450b rerun remains
necessary.

## Mechanism and trigger

The instrumented `9ee365bbd6` control reproduces the persistent collapse in
the ordinary paired **W5-exact/B 100/s** cell. In repetition 0 the cap goes
**32 → 16 → 8 → 4 → 2 → 1**, then remains 1 for **1661 completed batches**
through service shutdown. HTTP service p50 is **446.17 ms**, achieved
completion rate **70.15/s**, intended p99 **1469.05 ms**, and measured errors
**589/2000**. Durable counters equal every acknowledged write, including
warm-up. The last singleton has **12.94 ms service but 431.59 ms admission
age**, while the controller's rolling p99 is **489.16 ms**: queue age keeps
the cap pinned even though execution itself is fast. The paired fix retains
target 32, passes at **26.15 ms p99**, zero
errors and **100/s**, with exact counters.

The trigger is the first two-member batch after the inherited serial probes:
**124.81 ms service / 139.96 ms admission age** on main versus **16.26 ms
service / 28.69 ms admission age** with the fix. Both caps are still 32 at
that point. Cold pipeline entry crosses the 100 ms feedback threshold; the
resulting lower caps amplify queue age until singleton-only drain capacity
cannot sustain 100/s. Once the lane empties, an unchained singleton cannot
bootstrap the pipeline while the target remains 1.

A separate W4/B 100/s pilot also reaches 1, for 288 completed batches, before
recovering on this host's faster disjoint singleton path. Its p99 is 191.50 ms
and counters reconcile. That pilot overlaps the controller-only build and
is retained as diagnostic evidence; the paired campaign has no lane builds
or product tests running alongside it.

The cold pipeline path lazily constructs its second physical writer and
prepares constant fact statements and temporary final-check helpers. Those
costs occur after request admission in the control. Both the admission-age
controller and singleton pipeline exclusion already exist at `addae52bf4`.
WF round 2 subsequently adds the delivery reserve and cumulative deadline
assertion. Stage P adds `checks::load` to `Handle::connect_inner`, so the
lazy second-slot attach now performs catalog validation absent at the WF
revision; Stage P also changes guard/fence setup and typed tails. Source comparison
establishes those changes, not which introduced the historical S1-WP trigger.
No causal revision bisect is claimed. In the three paired W4/B 200/s runs,
the first multi-member batch takes **118.26/142.95/140.63 ms** service on main
and **35.19/29.89/24.24 ms** with the fix. This is a cold-entry comparison,
not per-call attribution of the catalog check alone. The cap is still 32
before these first batches in both arms, so later cap adaptation cannot
explain that initial service difference.

## Change

Adaptive collection always retains its **32-member maximum**. End-to-end p99
and fill counts remain diagnostics; they cannot reduce drain capacity. A
service-time-only shrink rule would still need a capacity proof for its
smaller caps. Retaining 32 removes that feedback state altogether. Fixed(N)
remains available for controlled tests.

Both Postgres writers prepare their constant protocol statements and temporary
helpers before queue construction returns, hence before HTTP READY. Preparation
failure refuses startup. This performs session-code DDL but no application
mutation or logical head advance. Request-shaped tail plans remain lazy.
Depth two never waits for collection. SQLite opens no additional writer and
retains the original recent-arrival policy and at most 1 ms of intentional
collection wait. FIFO order, N≤32, member deadlines, commit/outcome handling,
publication and the two-writer/29-reader/one-renewal budget remain unchanged.
The second writer is now reserved before any eligible batch arrives, so the
read pool starts with 29 physical slots instead of temporarily using 30.

The opt-in `SNAPBACK4_BATCH_TRACE` writes numeric completions using existing
BatchStats state: N, cumulative members, target, rolling p99, maximum admission
age and dispatch/preparation-through-completion service time. Both measured
arms carry the same trace instrumentation. Raw events remain outside Git.

The sizing amendments are in LLP 3000.009.001.000.000 §7,
LLP 3000.009.001.000.002 §3.4 and LLP 3000.009.001.000.000.002 §§3.6/8.1.

## Method

The existing `s1-onehost.py` Snapback runner and unchanged release
`sb4-scale-controls load` supply the fixture, native HTTP lifecycle,
open-loop arrivals, SLOs and durable-counter reconciliation. A private selector
imports that runner to alternate main/fix within each repetition (AB, BA, AB,
reversed in the next cell). Every arm/rate/repetition gets a fresh service.
The selector waits for the preceding owned lease to expire before restarting.
One main W5/B100 attempt loses ownership and its drain barrier refuses. The
stock runner then removes its cluster before capturing the final counter;
that attempt has **2000/2000 measured errors** and an unavailable counter
receipt. It remains an explicit additional failed attempt. The continuation
recreates the identical fixture and completes the missing counter-qualified
pair; its recovery path stops only the owned service and independently reads
the durable counter if a drain barrier refuses. The table uses three fully
reconciled pairs per cell, with this additional failure retained separately;
no all-passed qualification can override it. The checked-in runner now
retains its stopped private PG data on an unhandled exception, so that a
future drain failure cannot erase the counter evidence before reconciliation. Earlier completed pairs remain
part of the matrix and are not rerun.

The fixture has **32768 messages**, 1025 rooms, 256 users, 8448 memberships and
257 counters, with the standard image/maintained-total checks. An initial
10240-row setup was rejected by the generator's existing minimum before any
load ran; it is not a trial. G6 clock bounds are `1000,250`, arm S and depth
two are the defaults. Each trial uses 32 workers, **10 s warm-up + 20 s measured**,
three repetitions; qualification is intended p99≤100 ms, errors≤0.1% and exact
counter equality including warm-up acknowledgements.

Private PG16.15 clusters listen only on their own Unix sockets, port 55487;
no protected cluster or port 55440 is contacted. PG uses CPUs **54,59,65,81**,
server/proxy **3,55,62,77**, generator **26,95**. They were selected after
`mpstat -P ALL 1 3`; the sets share neither logical CPUs nor SMT siblings.
The same sets serve both arms. A/B use the stock proxy's 500/1000 µs added RTT.
Both clusters use shared_buffers=1 GiB, min/max WAL=80 MiB/1 GiB and
max_connections=320; these shared-host limits differ from the campaign's
8 GiB/4 GiB configuration and are identical between arms. Durability remains
fsync/synchronous_commit/full_page_writes on, with jit off. Both arms use
one shared target directory and identical release compiler/SQLite flags.
No lane build or test runs alongside the paired measurements.

Mean N below covers nonempty program completions during the entire load
cohort, including warm-up and refusals, excluding the inherited serial probes.
Target trajectories include the fresh service's probes. Mean N and achieved
rate are arithmetic means of the three repetition values. Achieved rate counts
completions in the measured wall window, so delayed warm-up completions can
make it briefly exceed the offered rate. Tables retain every repetition; a
cell passes only if all three pass. The additional incomplete ownership-loss
attempt is retained separately and is never treated as a pass.

## Verification

Counts are passed/failed; ignored and isolated subprocess summaries are not
folded into outer counts. These suites overlap and must not be summed.

| Check | Passed / failed | Notes |
| --- | ---: | --- |
| Controller/Arrivals and both-store queue regression | 8 / 0 | Includes private PG regression |
| Complete core lib | 864 / 0 | 499 ignored; explicit PG groups below |
| Complete binary | 626 / 0 | 75 ignored; corrected sibling-CLI layout, serial repeat |
| G7 including E | 92 / 0 + 2 / 0 | PG16 cases plus PG17-only transaction-timeout witnesses |
| PG17 G7.3 | 11 / 0 | Private PG17.11, independently stopped |
| Stage P | 13 / 0 | Direct and resumed flight faults |
| WF final boundary | 9 / 0 | Deadline/abort/unknown assertions retained |
| Program batch | 147 / 0 + 1 / 0 | Unchanged cases plus repaired admission-age fixture |
| G7.3 wire | 15 / 0 | Normal, three loss cuts, dispatch delay |
| Levers | 87 / 0 | Complete serial repeat after SQL readiness |
| E HTTP | 5 / 0 | Marker and hint/publication cuts |
| E crash/kill | 11 / 0 | No acknowledged loss; no live recorded processes |
| RT0 core / binary | 5 / 0 + 10 / 0 | Both stores; exact warm ratchets unchanged |
| Writer preparation witness | 1 / 0 | Both constant caches warm; no logical head advance |
| Ref-check | pass | 570 documents / 12064 refs, zero errors/unchecked |

Initial failures remain evidence. The first binary attempt is **621/5**:
four worker tests fail because copying the test executable outside Cargo's
layout breaks its sibling-CLI lookup, and one clock-handshake case also fails
under that initial concurrent setup. The corrected complete serial repeat is
626/0; no product assertion or timing bound changes. The first G7 run is
92/2 because PG17-only cases deliberately refuse PG16; both pass on PG17.
Program batch initially reports 147/1 because its corruption fixture installs
a foreign trigger before constructing the queue; eager writer validation now
correctly refuses that startup. The fixture injects the identical trigger
after preparation and passes in isolation. Levers initially report 85/2 from
Postgres “database system is starting up”; after a real SQL readiness probe,
the complete unchanged suite passes 87/0. These are not silently replaced
trials or SLO qualification.

The seed helper's inherited standalone lockfile initially refuses `--locked`.
Its sole required update is the path core version 0.4.40→0.4.42; it is built
offline and the original tracked lockfile is restored. No product dependency
or assertion is changed.

## Paired results

**192 fully reconciled trials, zero counter mismatches.** The fix is
**24/24** in the cliff grid versus **22/24** on main. Main also has the
additional ownership-loss attempt described above. Across the complete grid,
main passes 46/96 repetitions and fix 50/96; those totals mix intentionally
unsustainable rungs and are not a capacity estimate.

No broad high-rate capacity increase is established. W4's all-three passing
rungs remain 2690/s on A and 2262/s on B; nominal mix/B remains 2262/s.
Exact/B 1600/s **regresses from main 3/3 to fix 1/3** in this relative run.
The failed fix repetitions have intended p99 109.90/110.89 ms, generator
dispatch-lag p99 89.92/90.90 ms and HTTP service p99 25.05/27.46 ms. The causal
source of that lag is not isolated. All higher exact/B rungs fail on both
arms. Retain this regression for the authoritative host rerun; do not promote
these observations into a capacity or publication claim.

The unchanged main passes exact/B 800/s 3/3 despite trapping at 100/s, which
also establishes that the failed low-rate state is below batched capacity.
Many high-rate misses retain target 32 on both arms, so this local run does
not support attributing their ceilings to cap shrinkage.

Pass counts are out of three. p99 and error rate are the worst repetition;
achieved rate and mean N are means of repetition values.

| Cell | /s | Pass main/fix | Worst p99 ms main/fix | Max errors % main/fix | Achieved /s main/fix | Mean N main/fix |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| W4/B | 100 | 2/3 · 3/3 | 121.8 / 19.3 | 0.6 / 0 | 100 / 100 | 1.01 / 1.00 |
| W4/B | 200 | 3/3 · 3/3 | 18.2 / 17.9 | 0 / 0 | 200 / 200 | 1.27 / 1.25 |
| W4/B | 400 | 3/3 · 3/3 | 15.4 / 13.4 | 0 / 0 | 400 / 400 | 1.05 / 1.04 |
| W4/B | 800 | 3/3 · 3/3 | 16.8 / 11.9 | 0 / 0 | 800 / 800 | 1.99 / 2.01 |
| W5-exact/B† | 100 | 2/3 · 3/3 | 1469.1 / 28.3 | 29.45 / 0 | 90 / 100 | 1.38 / 1.25 |
| W5-exact/B | 200 | 3/3 · 3/3 | 19.1 / 19.0 | 0 / 0 | 200 / 200 | 1.06 / 1.05 |
| W5-exact/B | 400 | 3/3 · 3/3 | 14.1 / 14.3 | 0 / 0 | 400 / 400 | 1.50 / 1.47 |
| W5-exact/B | 800 | 3/3 · 3/3 | 15.7 / 15.6 | 0 / 0 | 800 / 800 | 3.33 / 3.27 |
| W4/A | 1600 | 3/3 · 3/3 | 10.9 / 10.1 | 0.0125 / 0 | 1600 / 1600 | 3.34 / 3.27 |
| W4/A | 2262 | 2/3 · 3/3 | 310.9 / 15.3 | 0.03758 / 0.008842 | 2281 / 2262 | 5.69 / 5.46 |
| W4/A | 2690 | 3/3 · 3/3 | 29.5 / 20.7 | 0.01301 / 0.0316 | 2690 / 2690 | 6.73 / 6.38 |
| W4/A | 3200 | 1/3 · 2/3 | 53.1 / 221.5 | 0.1328 / 0.1016 | 3196 / 3199 | 8.21 / 8.18 |
| W4/A | 3805 | 0/3 · 0/3 | 1010.8 / 761.3 | 4.317 / 0.6597 | 3744 / 3736 | 10.68 / 10.70 |
| W4/A | 4525 | 0/3 · 0/3 | 1010.3 / 1014.0 | 17.61 / 20.29 | 3801 / 3666 | 11.04 / 11.04 |
| W4/B | 1600 | 3/3 · 3/3 | 11.5 / 11.5 | 0 / 0 | 1600 / 1600 | 4.84 / 4.75 |
| W4/B | 2262 | 3/3 · 3/3 | 12.8 / 13.1 | 0.004421 / 0 | 2262 / 2262 | 7.40 / 7.54 |
| W4/B | 2690 | 0/3 · 2/3 | 42.9 / 25.1 | 0.2063 / 0.1896 | 2685 / 2687 | 9.17 / 9.09 |
| W4/B | 3200 | 0/3 · 0/3 | 1011.9 / 1012.9 | 3.898 / 7.439 | 3110 / 3039 | 11.22 / 11.01 |
| W4/B | 3805 | 0/3 · 0/3 | 1013.4 / 1012.9 | 29.05 / 26.34 | 2839 / 2927 | 10.94 / 11.08 |
| W4/B | 4525 | 0/3 · 0/3 | 1012.9 / 1012.9 | 34.56 / 34.53 | 3054 / 3055 | 11.11 / 11.17 |
| W5-mix/B | 1600 | 3/3 · 3/3 | 12.8 / 12.6 | 0 / 0 | 1600 / 1600 | 5.28 / 5.22 |
| W5-mix/B | 2262 | 3/3 · 3/3 | 25.4 / 19.8 | 0.01989 / 0.05747 | 2261 / 2261 | 8.15 / 8.66 |
| W5-mix/B | 2690 | 0/3 · 0/3 | 694.7 / 1013.4 | 0.3587 / 2.379 | 2666 / 2614 | 10.30 / 10.37 |
| W5-mix/B | 3200 | 0/3 · 0/3 | 1013.4 / 1013.4 | 10.9 / 12.88 | 2904 / 2879 | 10.95 / 11.25 |
| W5-mix/B | 3805 | 0/3 · 0/3 | 1014.0 / 1014.0 | 25.32 / 25.96 | 2916 / 2870 | 11.22 / 11.03 |
| W5-mix/B | 4525 | 0/3 · 0/3 | 1013.4 / 1014.5 | 38.62 / 42.37 | 2840 / 2703 | 11.20 / 11.03 |
| W5-exact/B | 1600 | 3/3 · 1/3 | 32.1 / 110.9 | 0.01875 / 0.2781 | 1600 / 1598 | 9.09 / 9.12 |
| W5-exact/B | 2262 | 0/3 · 0/3 | 1019.2 / 1019.7 | 18.05 / 16.15 | 1987 / 1940 | 11.24 / 11.26 |
| W5-exact/B | 2690 | 0/3 · 0/3 | 1019.7 / 1019.7 | 30.83 / 29.19 | 1941 / 1975 | 11.07 / 11.33 |
| W5-exact/B | 3200 | 0/3 · 0/3 | 1019.7 / 1029.7 | 42.29 / 46.3 | 1958 / 1795 | 11.01 / 10.92 |
| W5-exact/B | 3805 | 0/3 · 0/3 | 1019.7 / 1019.7 | 53.52 / 51.6 | 1886 / 1901 | 11.04 / 11.12 |
| W5-exact/B | 4525 | 0/3 · 0/3 | 1019.7 / 1019.7 | 61.15 / 61.02 | 1831 / 1814 | 10.87 / 10.91 |

† One additional main exact/B100 attempt has 2000/2000 measured errors after
ownership loss and lacks its counter receipt because the original cleanup
removed the cluster. It remains a failed, non-qualifying attempt; it is not
included among the three fully reconciled pairs in the table.

Target trajectories below are r0 / r1 / r2. A downward arrow compresses
successive halvings; an upward arrow compresses successive +1 increases.
Thus `32↓1` means `32→16→8→4→2→1`; `16↑32` visits every integer. A lone 32
means no resize. All traces include startup probes and the complete cohort.

| Cell | /s | Main r0 / r1 / r2 | Fix r0 / r1 / r2 |
| --- | ---: | --- | --- |
| W4/B | 100 | 32↓16↑32 / 32 / 32 | 32 / 32 / 32 |
| W4/B | 200 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/B | 400 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/B | 800 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B† | 100 | 32↓1 / 32↓8↑32 / 32↓8↑32 | 32 / 32 / 32 |
| W5-exact/B | 200 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 400 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 800 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/A | 1600 | 32 / 32 / 32 | 32 / 32 / 32 |
| W4/A | 2262 | 32↓16↑32 / 32 / 32 | 32 / 32 / 32 |
| W4/A | 2690 | 32 / 32 / 32 | 32 / 32 / 32 |
| W4/A | 3200 | 32 / 32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/A | 3805 | 32↓16↑32 / 32 / 32 | 32 / 32 / 32 |
| W4/A | 4525 | 32 / 32 / 32 | 32 / 32 / 32 |
| W4/B | 1600 | 32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/B | 2262 | 32↓16↑32 / 32 / 32 | 32 / 32 / 32 |
| W4/B | 2690 | 32 / 32 / 32 | 32 / 32 / 32 |
| W4/B | 3200 | 32 / 32 / 32 | 32 / 32 / 32 |
| W4/B | 3805 | 32 / 32 / 32↓16↑32 | 32 / 32 / 32 |
| W4/B | 4525 | 32 / 32 / 32 | 32 / 32 / 32 |
| W5-mix/B | 1600 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-mix/B | 2262 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-mix/B | 2690 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-mix/B | 3200 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-mix/B | 3805 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-mix/B | 4525 | 32↓16↑32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 1600 | 32 / 32↓16↑32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 2262 | 32↓16↑32 / 32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 2690 | 32↓16↑32 / 32 / 32↓16↑32 | 32 / 32 / 32 |
| W5-exact/B | 3200 | 32↓16↑32 / 32 / 32 | 32 / 32 / 32 |
| W5-exact/B | 3805 | 32 / 32 / 32 | 32 / 32 / 32 |
| W5-exact/B | 4525 | 32↓16↑32 / 32↓16↑32 / 32 | 32 / 32 / 32 |


## Custody

All raw logs, histograms, fixtures, session files, binary copies and PID/birth
ledgers are private under `/tmp/bctl-20261027` or the runner's recorded private
roots. Only summaries enter Git. No fetch, push, stash, Git configuration
change, credential import or publication is performed. The final birth-bound audit checks **27603 recorded identities**:
**no live or zombie recorded PID and no process using an owned private path**.
All private cluster cleanup receipts report no remaining process and absent
PID/socket files; test PG16/17 also have independent stopped-status receipts,
and the crash cluster's PID file is absent. The disk guard never fires.

The exact staged source/report audit compares **1028 generated fixture
credentials across 12 staged files: zero matches**. Private fixture token
files are removed after that comparison. Free `/home` space at the bookend
is **82.07 GiB** (2026-10-27T02:55:58.734690+00:00). No raw logs, data or credentials enter Git.

Binary integrity after the complete matrix:

| Arm | SHA-256 |
| --- | --- |
| main | `0556b7d3a1c421e5111415d1236e865f7fb4f26da7a86de1d432c5661cb739cb` |
| fix | `25f649332271cf5e9402de9dbf5b1c414acd80dc6a04fa5156e28efffaf6bb43` |
