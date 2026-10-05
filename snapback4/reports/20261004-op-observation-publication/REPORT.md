# OP — observation publication under repeated evidence

Date: 2026-10-05. Branch: `sb4-intent/op-observation-publication`.
Baseline: `ed327e5dc715bca1c3df098b794219c1e07ff028` (incoming `origin/main`).
All work and measurement used this lane's worktree on eb1000 (hostname
`expose-builder-pixel`). No other host, worktree or lane process was used.

## Finding and correction

A matching live reply can be repeatedly rejected even though its server cut
already covers the evidence that advanced the client's revision. The old
checkpoints required identical authority and observation change versions at
every await, including after decoding `/q/home`, checking queued predictions,
Following intent checks, the evaluator's publication, and the caller's final
publication. `notified`, `changed`, the apply commit and `applied` can advance
those versions several times for the same durable cut. The queue eventually
accepts a reply only when its whole attempt finds an evidence-free interval.
Increasing its eight active attempts would not prove publication safe.

The historical LU trace (+21.3 ms decoded, +992.0 ms observation) was not
reproduced at exactly that duration. Current main reproduced the same shape
with a matching reply decoded at **+16.9 ms**, returned to the evaluator at
**+21.8 ms**, and published only at **+799.6 ms**. Initial idle repost p95 was
156.4 ms; the reverse-order baseline measured 483.8 ms, maximum 800.0 ms.
The original baseline's 20-burner p95 was 869.9 ms, maximum 1,295.0 ms.
These are LU's current three-browser fixture, not calibration's frozen app.

The final client has two independent publication proofs:

1. A **whole-server** answer may cover sequenced notifications and explicitly
   published ordinary applies. Their maximum cut must be no newer than the
   response, and no hard boundary may have occurred since evaluation began.
   An apply needs known-empty predictions, `published: true`, valid watermark
   and `images_at >= watermark`, with no snapshot/staging/catchup. `images_at`
   is the floor because images can be newer than the streamed log watermark.
2. A local or composed evaluation may survive evidence with **known disjoint
   inputs**. Table stamps use the existing revision; the proof checks static
   program/rule dependencies plus every observed table. It does not use the
   server cut. Unknown footprints, opaque native dependencies, intersecting
   changes and hard boundaries refuse it.

A disjoint replica footprint proves only local inputs. Any external component
also needs its own cut to cover the pending server evidence. Compositions
require both proofs, and remembered recovery retains its original authority
fence. This candidate-specific check runs before cache writes.

Both proofs account for the watch change version: only increments recorded by
the evidence path may be covered. An unaccounted increment stays fenced even
after later accounted evidence. They are captured before evaluation and checked through the final
caller continuation and delivery approval. Prediction admission is fenced
before its first await. Settlement, scope removal, store/schema/session reset,
unknown changes and unpublished sync cuts remain hard boundaries. Withdrawal
still bypasses observation capacity. Reset versions, credentials, incarnation,
pending scope/change cuts, cancellation and expiry are still checked. A newer
server cut cannot certify an old local field or retained-routing decision.
Retained-sensitive whole-server routing, ordinary search and ephemeral reads
retain their existing separate procedures. Direct one-shots keep their bounded
retry procedure. No new application API, awaited host call, server request,
queue capacity, retry timer or retention budget was added.

The publication rule is recorded in LLP 3000.023 §10, with pointers in
LLP 3000.016 §2.2 and 3000.028 §3.2. [CONTEXT.md](./CONTEXT.md) records the
orientation constraints, including `guide reads` and `guide sync`.

## A rejected reply, and what finally admitted one

[paired-before.guards.json](./paired-before.guards.json) retains the reverse-order
baseline's 60 idle receiver observations and its slowest trace. Times below
are milliseconds after the source commit in zero-based trial 26, Carol:

| Time | Event and consequence |
| ---: | --- |
| 13.767 | `/sync` watermark 6809 is decoded. |
| 16.867 | A matching `/q/home` body at cut 6809 is decoded. |
| 20.667 | The apply commit advances authority 5613 → 5614; no scope loss occurs. |
| 21.767 | `post` returns after response/session/store checks. The post-response checkpoint rejects it solely for changed authority; watch version remains 1382 and incarnation remains 1. |
| 22.467 | `applied` advances authority again, to 5615, at the same cut 6809. |
| 25.920 | The fresh item's final follower-copy commit completes; Carol already had her copy in the earlier matching reply. |
| 780.267 | A cut-6889 response is decoded; notification/change evidence subsequently rejects it too. |
| 789.067 | A cut-6890 response is decoded. |
| 789.867 | Apply advances authority 5761 → 5762. |
| 790.567 | The cut-6890 response is rejected for that authority change. |
| 790.667 | Published sync advances authority to 5763, still at cut 6890. |
| 798.867 | Another response at the **same cut 6890** is decoded. |
| 799.467 | It returns at unchanged authority 5763 and becomes a candidate. |
| 799.567 | Observation publication succeeds. |
| 799.967 | React renders. |

There are 47 authority and 38 change-version checkpoint rejections, plus 85
corresponding `rerun` rejections, over this interval. `checkpoint` returns an
interrupted/loading result; `rerun` marks it dirty because its captured versions
are obsolete. Published applies reject replies even after transport finishes.
The last rejected and accepted answers have the same server cut: the success
came from an evidence-free interval, not a new semantic result, extra observation
slot or relaxed timer.

The first baseline independently shows the same mechanism at shorter duration:
trial 12, Carol, decodes matching cut 3207 at +49.786 ms; notification/change
evidence at +61.186 ms makes the +73.286 ms post-response checkpoint reject it.
Only a later quiet attempt publishes at +196.686 ms and renders at +197.286 ms.
[before.guards.json](./before.guards.json) retains that full trace and all 60
receiver records. These windows include earlier nonmatching attempts too.

Across all 60 baseline idle repost observations there are 258 checkpoint
rejections (139 authority, 119 change) and 258 corresponding `rerun`
rejections. The final run has five uncovered checkpoint/re-run rejections;
it still rejects evidence that it cannot prove safe. Pending-cut checks still reject twice before and seven times after. Counts include earlier nonmatching attempts in each
commit-to-render window, so they are not counts of discarded matching bodies.

Final pooled receiver p95 from first matching evaluation to observation is
**8.5 ms**, versus **77.6 ms** before; maxima are 21.6 versus 146.9 ms.
Publication-to-React p95 remains 0.8 ms. The final slowest idle trial spends
93.3 ms reaching the final fresh delivery, decodes a match at 116.9 ms,
publishes at 117.7 ms and renders at 118.6 ms. Its accepted server candidate
has cut 2338 and crosses authority 26 → 28; the proof admits it without
waiting for an evidence-free attempt.
[final.guards.json](./final.guards.json) contains its trace. These stage
distributions overlap; do not add their p95s. The server's final fan-out commit
can follow an individual receiver's answer; raw negative intervals are retained.

## Three-browser measurement

Unchanged LU fixture: Alice writes; Bob and Carol render independent React
views using the wasm device and IndexedDB. Seed 1,000 historical posts, unfollow
and refollow Bob immediately before each write, and perform 30 writes per
shape/load cell. All phases use the same instrumented production server
`target/lu-op`; only the frozen SDK differs. Baseline and final SDK tracing is
confined to copies under ignored `target/op/`, not shipping sources. All 240
files in the measured final SDK match a fresh freeze of the qualified build.

The primary statistic takes the slower receiver for each write, then uses
nearest-rank percentiles. Each row is 30 writes / 60 receiver renders. Values
are milliseconds from source commit to React render. `0/20/120` are numbers
of permanently runnable burner processes on ten CPUs, not host-wide load.

| Burners | Shape | Before p50 / p95 / max | Final p50 / p95 / max |
| ---: | --- | ---: | ---: |
| 0 | repost | 74.2 / 156.4 / 197.3 | 48.4 / 105.5 / 118.6 |
| 0 | message | 52.2 / 82.2 / 120.9 | 49.9 / 74.9 / 77.8 |
| 0 | reaction | 40.5 / 61.1 / 62.3 | 41.1 / 58.7 / 63.5 |
| 20 | repost | 157.3 / 869.9 / 1295.0 | 79.2 / 154.7 / 223.3 |
| 20 | message | 222.9 / 477.6 / 621.5 | 184.1 / 264.2 / 409.8 |
| 20 | reaction | 171.2 / 237.7 / 266.2 | 155.2 / 216.1 / 220.1 |
| 120 | repost | 460.9 / 1121.2 / 1463.0 | 256.9 / 446.3 / 451.4 |
| 120 | message | 866.3 / 1276.7 / 1492.9 | 504.4 / 878.4 / 1035.4 |
| 120 | reaction | 588.0 / 844.0 / 919.1 | 527.7 / 911.0 / 929.9 |

Idle repost meets the requested 500 ms target. Repost and message p95 improve
against the original baseline at every load. Heavy reaction p95 is 911.0 ms
versus 844.0 ms before (+8%), despite a lower median. This tail increase is
retained and investigated with a fresh adjacent baseline/final sequence below;
no blanket improvement across all cells is claimed.

[Before summary](./before.summary.json), [final summary](./final.summary.json)
and [before](./before.stamps.csv) / [final](./final.stamps.csv) stage CSVs retain
all 270 writes / 540 renders per revision. The explicit
[before idle repost](./before.idle-repost.csv) and
[final idle repost](./final.idle-repost.csv) CSVs retain every stage for the
requested 30 trials, both receivers. Missing stamps remain missing.

### Reverse-order baseline

A baseline replay after the preceding development candidate reproduced the
799.6 ms publication trace above. Its p95s are 483.8 / 750.7 / 918.3 ms for
repost, 347.7 / 478.2 / 834.2 ms for message and 48.2 / 191.2 / 512.4 ms for
reaction at 0 / 20 / 120 burners. This replay precedes the final callback fence;
it is a variability control, not an adjacent final comparison.

[Repeated baseline summary](./paired-before.summary.json) and
[stamps](./paired-before.stamps.csv) retain every trial. This is an independent
run, not a pool that hides either baseline's tail.

### Adjacent final baseline/fix repeat

Run another complete `0,20,120` sequence on baseline, then final OP, with fresh
fixtures and 30 trials per cell each. The final product and SDK hashes are
unchanged. Idle repost p95 is **709.4 → 81.0 ms**. The baseline's worst idle
trace decodes a match at +41.6 ms and publishes at +1,123.7 ms, with 118
checkpoint/re-run rejections. The final run's slowest idle render is 90.4 ms.

| Burners | Shape | Adjacent baseline p50 / p95 / max | Final repeat p50 / p95 / max |
| ---: | --- | ---: | ---: |
| 0 | repost | 246.4 / 709.4 / 1124.3 | 33.9 / 81.0 / 90.4 |
| 0 | message | 83.5 / 366.8 / 407.5 | 41.7 / 55.6 / 57.6 |
| 0 | reaction | 31.1 / 43.5 / 50.9 | 28.5 / 49.8 / 55.8 |
| 20 | repost | 203.6 / 598.8 / 1584.9 | 86.9 / 139.5 / 169.4 |
| 20 | message | 171.2 / 493.3 / 1002.2 | 142.1 / 206.7 / 353.3 |
| 20 | reaction | 118.7 / 174.2 / 215.2 | 120.3 / 169.7 / 195.2 |
| 120 | repost | 316.6 / 771.3 / 869.3 | 226.0 / 449.8 / 450.4 |
| 120 | message | 590.9 / 1034.2 / 1269.3 | 488.9 / 824.1 / 852.0 |
| 120 | reaction | 463.3 / 710.7 / 810.6 | 514.6 / 694.4 / 788.0 |

The earlier heavy-reaction p95 increase does not repeat: 710.7 → 694.4 ms
in this adjacent pair. Its median is higher (463.3 → 514.6 ms), and idle
reaction p95 is higher by 6.2 ms. Repost and message p95 improve at every load.
Thus the data support removal of publication starvation and substantial repost
and message improvement, with variable reaction latency; they do not establish
zero regression in every statistic. This is two independent 30-trial samples,
not a pool selected to hide the slower final tail.

For heavy reaction, pooled receiver evaluation-to-publication p95 falls
38.6 → 10.7 ms in the first comparison and 32.3 → 17.0 ms in the adjacent
repeat. Publication-to-React is 27.7 → 27.9 ms and 29.7 → 26.5 ms. These
60-receiver stage distributions support publication progress; their ranks
differ from the primary 30-write statistic, and they are neither added nor
substituted for its tail.

[Adjacent baseline summary](./paired-final4-before.summary.json),
[final repeat summary](./paired-final4-after.summary.json), their matching
`.stamps.csv` files and `.guards.json` traces retain the complete runs.

### Ordinary live control (no history or refollow)

Use `LU_HISTORY=0 LU_REFOLLOW=0`, still 30 writes per shape/load and the same
three-browser fixture. Final repost p95 is higher by 7.6 ms idle and 17.1 ms
at 20 burners; idle message is higher by 8.7 ms and reaction by 0.9 ms. All heavy
p95s improve against this original baseline. Small-sample tail increases are
retained rather than hidden behind a blanket no-regression claim.

| Burners | Shape | Before p50 / p95 / max | Final p50 / p95 / max |
| ---: | --- | ---: | ---: |
| 0 | repost | 49.8 / 71.3 / 98.9 | 49.9 / 78.8 / 78.9 |
| 0 | message | 34.5 / 42.9 / 52.0 | 34.3 / 51.6 / 52.4 |
| 0 | reaction | 29.2 / 38.3 / 41.0 | 28.9 / 39.2 / 39.5 |
| 20 | repost | 67.6 / 100.8 / 125.6 | 62.5 / 117.9 / 151.4 |
| 20 | message | 79.6 / 97.3 / 98.4 | 73.9 / 95.1 / 106.9 |
| 20 | reaction | 55.2 / 77.2 / 100.8 | 46.9 / 59.7 / 81.8 |
| 120 | repost | 172.8 / 261.3 / 276.9 | 160.1 / 233.9 / 269.0 |
| 120 | message | 189.5 / 279.0 / 391.5 | 181.0 / 273.1 / 309.0 |
| 120 | reaction | 134.2 / 218.3 / 265.3 | 121.7 / 158.8 / 242.0 |

Pooled receiver repost evaluation-to-publication p95 is 1.1 → 1.3 ms idle
and 24.9 → 12.7 ms at 20 burners; delivery-to-render p95 is 48.6 → 50.3 ms
and 71.6 → 75.1 ms respectively. These pool 60 receivers, whereas the primary
statistic uses the slower receiver of each of 30 writes, so their percentile
ranks differ. No stage percentile is added or substituted for the primary tail.
[Baseline summary](./steady-before.summary.json),
[final summary](./steady-final.summary.json) and their matching `.stamps.csv`
files retain every ordinary-control update.

The repeat baseline's repost p95 is 71.4 / 125.4 / 285.9 ms at 0 / 20 /
120 burners. Thus the moderate repost increase does not repeat; final idle
repost remains about 7.5 ms higher at this 30-trial primary tail. Reaction and
message tails vary too: repeat-baseline p95 is 34.9 / 68.8 / 174.0 ms for
reaction and 41.4 / 88.6 / 392.3 ms for message. All three ordinary-control runs
are retained (`steady-before.*`, `steady-final.*`, `steady-before-repeat.*`).
A claim of zero regression in every browser tail is not supported.

### Paired ordinary client control

To separate client cost from independent browser runs, adapt RH round 1's
paired harness in [latency.mjs](./latency.mjs). The baseline and fixed clients
observe each **same mutation concurrently**, on both wasm and process devices.
Run 300 measured mutations per host/mode in each creation order, dropping ten
warm-ups per run: 600 paired samples per host/mode, 4,800 source mutations and
9,600 measured client observations in total. Both use the same native server
and device engine; the wasm bytes are identical. The clock here is mutation
invocation to a complete, non-revalidating observation, **not** React rendering
or LU's source-commit clock. No Following backfill or CPU burner is injected;
all descendants are confined to freshly checked CPUs 80–83.

| Host | Mode | Before p50 / p95 | Final p50 / p95 |
| --- | --- | ---: | ---: |
| process | current-history-fallback | 8.282 / 11.395 | 8.101 / 11.661 |
| process | current-search | 8.318 / 10.841 | 8.345 / 10.849 |
| process | known-local | 8.102 / 11.215 | 7.998 / 10.851 |
| process | server-only-source | 6.952 / 9.482 | 3.291 / 6.896 |
| wasm | current-history-fallback | 10.467 / 13.995 | 10.539 / 13.673 |
| wasm | current-search | 9.837 / 13.137 | 9.835 / 13.969 |
| wasm | known-local | 7.322 / 9.904 | 7.330 / 10.222 |
| wasm | server-only-source | 6.286 / 11.229 | 5.040 / 9.321 |

The largest pooled p50 increase is 0.072 ms (wasm history); the largest p95
increase is 0.832 ms (wasm search). Retained-history p95 changes by +0.267 ms
on process and −0.323 ms on wasm; known-local changes by −0.364 / +0.318 ms.
Server-only-source p95 improves by 2.586 / 1.908 ms. This shows no material
ordinary client slowdown in the paired control; it does not erase browser-tail
variation or claim a formal non-inferiority bound. [Summary](./ordinary-paired-summary.json)
includes per-mutation paired differences, with both [creation orders](./ordinary-paired.json)
and [reverse order](./ordinary-paired-reverse.json) retained separately.

```sh
RH_RUNS=300 taskset -c 80-83 \
python3 reports/20261003-lu-live-update-latency/tools/confine.py \
node reports/20261004-op-observation-publication/latency.mjs
RH_RUNS=300 RH_REVERSE=1 RH_OUT=../../target/op/ordinary-paired-reverse.json \
taskset -c 80-83 python3 reports/20261003-lu-live-update-latency/tools/confine.py \
node reports/20261004-op-observation-publication/latency.mjs
```

### Superseded candidate: heavy-only diagnostic repeat

Fresh fixture, same 1,000-row history/refollow behavior, 30 trials per cell,
but `LU_LEVELS=120` starts immediately at heavy load. Run the disjoint-only development candidate first, then
baseline, reversing the original order. This candidate was later discarded
for the safety gap described below; these are not final qualification results. This changes the accumulated workload
at heavy phase entry, so it is kept separate from the full sequence.

| Shape | Before p50 / p95 / max | Final p50 / p95 / max |
| --- | ---: | ---: |
| repost | 461.3 / 1408.0 / 1623.1 | 143.1 / 333.9 / 486.1 |
| message | 499.0 / 1086.7 / 1583.6 | 255.9 / 401.9 / 542.2 |
| reaction | 269.4 / 474.5 / 477.7 | 246.9 / 340.5 / 362.4 |

The earlier disjoint-only candidate had reaction p95 910.6 ms versus baseline
844.0 ms in the full sequence. That increase did not repeat here. Both runs
remain development evidence and establish no final-candidate claim.
See `repeat-before.*` and `disjoint-heavy.*` for both complete diagnostic runs.

### Development finding retained

The initial candidate proved only whole-server coverage. It improved idle
repost p95 to 67.3 ms but regressed idle message to 478.9 ms and heavy message
to 1,842.6 ms. This is not a qualified candidate. Its
[summary](./initial.summary.json), [stamps](./initial.stamps.csv) and
[message trace](./initial-message-trace.json) are retained.

The slow message was already matched at +10.8 ms, yet rendered around +800 ms.
There were 110 checkpoint/re-run rejections, 79 decoded replies, and 40 applies
plus 40 publication notifications. Following-only evidence did not change
history's watch version; it still changed global authority. RH can classify
that history result as a composition, so allowing it to borrow the new server
cut would be wrong. The final disjoint-input proof validates the actual local
inputs instead. This correction is why the final candidate includes both
proofs. Its disjoint-input negative control fails when that proof is disabled.

### Safety review correction

The disjoint-only candidate could mistake a replica footprint for complete
server evidence: an ordinary published apply at cut 41 could touch only an
unrelated local table while a cut-40 server reply still used older server-only
authorization. Two deterministic negative controls reproduce publication of
that old answer, both whole-server and composed. This candidate was discarded.
The final candidate independently requires the external component's cut to
cover pending server evidence, as well as unchanged local inputs for a
composition. Remembered recovery cannot renew authority this way. Additional
cases reject changed local inputs despite a covering server cut, and check the
proof again after the evaluator returns.

### Full-suite boundary correction

The first full run on the preceding candidate passed all Rust tests and both
seeded client models but failed 12 callback-boundary cases in the existing
`per-row-inflight` and `per-row-boundaries` files. Those cases advance the watch
version directly at publication. A covering cut/disjoint footprint had wrongly
accepted that unaccounted change. The final private watch counter checks that
every version increment since capture came through the evidence path; later
accounted evidence cannot erase a mismatch. Two new deterministic cases retain
this schedule for local and server answers; both fail on the preceding
version-unchecked candidate (34 other pure cases pass). All 86 publication and callback
cases pass, and both existing files are added to every final stress repetition.

A compiler mutation test also still targeted the old `runLocal` return text.
Its target string was updated to the new condition, preserving its deadline
assertion; all 17 compiler checks pass. The first full run therefore remains a
recorded failed development qualification (13 failed cases across three files),
not a passing final result. Its complete logs and result are retained separately; the
[initial qualification record](./initial-qualification.json) lists its gates.

## Qualification

- New deterministic regressions: 36 evaluator/evidence cases plus two actual
  process/wasm live cases. Each live case forces a real sync after decoding
  every matching reply. The final client publishes the first reply; the
  baseline rejects six and fails both tests. Pure cases cover repeated
  notifications/applies at each await, the caller gap, old/invalid cuts,
  newer images, admission, settlement, retained components/masks, scope loss,
  store replacement, unknown footprints and authorization dependencies.
- Final focused routing, observation, RH, live and existing cross-tier/scope/withdrawal
  authority checks: **697/697** pass.
- Client typecheck passes.
- **30/30** four-CPU hog repetitions pass: **16,950 cases** (565 each),
  with no failures, cancellations or skips. Each of three ten-run batches
  owns one hog; all six coordinator/hog PIDs were confirmed exited.
- The full suite passes in **2,264 seconds**: 5,002 Rust tests + 17 doctests, 6,315 client passes (318 files), 9 fixture tests and 79 model cases. Existing 33 Rust ignores and 11 client skips remain; no counts or timeouts were reduced.

Wasm was rebuilt with the locked toolchain: **2,117,335 B raw / 639,810 B
gzip**, unchanged from the baseline. The existing **639,940 B** cap retains
exactly **130 B** for the recorded macOS allowance. No cap change or macOS
measurement is claimed. The product changes are TypeScript only. Largest sampled whole-worktree use was **16.89 GB**, below 40 GB. [Qualification records](./qualification.json) retain every gate and Rust target summary.

## Reproduction and custody

Use Node 24.13.1, Bun 1.3.14 and Rust 1.97.0 on this Linux host. From
`snapback4/`, install with `bun install --frozen-lockfile`, build the wasm and
client, and freeze each revision with:

```sh
python3 reports/20261004-op-observation-publication/trace-sdk.py before
# After applying OP and rebuilding the package:
python3 reports/20261004-op-observation-publication/trace-sdk.py final4
```

Build the server once using LU's `tools/instrument.py op`, which restores its
temporary source instrumentation in `finally`. Use
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` to
limit build storage. For the native suite also use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Choose idle CPU masks
from a fresh `/proc/stat` sample, including their SMT siblings; these commands
show the measured mask, not a permanent CPU reservation:

```sh
SNAPBACK4_BIN=target/lu-op LU_SDK=target/op/sdk-before/dist LU_LABEL=op-before \
LU_RUNS=30 LU_HISTORY=1000 LU_REFOLLOW=1 LU_LEVELS=0,20,120 \
LU_OUT=target/op/before.json taskset -c 80-89 \
python3 reports/20261003-lu-live-update-latency/tools/confine.py \
node reports/20261003-lu-live-update-latency/tools/measure.mjs
# Repeat with sdk-final4, op-final4 and final4.json after the first run exits.
node reports/20261003-lu-live-update-latency/tools/finalize.mjs \
  target/op/before.json target/op/final4.json
python3 reports/20261004-op-observation-publication/trace-summary.py \
  target/op/before.json.jsonl
```

`confine.py` locks inherited affinity using seccomp, including Chromium's GPU
threads. Read-only audits inspect only the owned measurement PID tree. The
keeper owns and reaps its burners. Measurement uses CPUs 80–89 (physical cores
32–41), separate from the three four-core stress batches: 9,22,30,31;
1,43,45,46; and 7,11,16,21. Each batch owns one hog and runs ten repetitions. Other lanes may
use the host; global load and scoped busy counters are retained rather than
claiming exclusive ownership. Follow LU's [tools README](../20261003-lu-live-update-latency/tools/README.md)
for event/stage definitions and missing/overlapping intervals.

```sh
taskset -c 9,22,30,31 \
python3 reports/20261003-lu-live-update-latency/tools/confine.py \
python3 reports/20261004-op-observation-publication/stress.py
# After all 30 repetitions and hog cleanup, select idle CPUs and run:
taskset -c <idle-cpus> bash scripts/test.sh
```

`stress.py` fixes the same 18 client files for all repetitions and reaps its
single owned hog in `finally`. `OP_STRESS_FIRST`, `OP_STRESS_LAST` and
`OP_STRESS_OUT` select independent batches; final qualification uses
1–10, 11–20 and 21–30 on the three masks above. An initial development stress run was stopped
after three complete passing repetitions when the message regression was
found. The disjoint-only candidate completed thirteen passing repetitions
before the external-component counterexample was found. Neither development
run is counted as final qualification. The version-unchecked candidate also
completed thirty repetitions before the first full suite found its callback
boundary gap; those results remain development evidence. Full raw logs, JSONL traces,
frozen SDKs and binaries stay ignored under `target/op/`. [evidence.json](./evidence.json) records source hashes, frozen-SDK manifest
hashes, raw-log digests, CPU samples/audits and qualification results.
The original disk sampler stopped when a temporary test database vanished during `du`; the final waiting coordinator was replaced before any full-suite test started, so that race cannot interrupt qualification. The product result is the completed `full-suite-result.json`, independent of the replaced wrapper. Compact evidence is retained in this report directory. No raw artifact above 256 KB is
committed. No push or publication is authorized or performed.

## Round 1 — review corrections (2026-10-05)

Based on **c43a86a440**. Astra's round-0 verdict was READY; Grok's was READY
WITH CHANGES. This round addresses Grok's one Medium and two Lows without
removing either round-0 publication proof. The review remains at
`~/sb4-intent/reviews/op-r0.grok.md`; it was read without changing that review
worktree or its processes.

### Findings and final rules

1. **Late watermark-only catch-up.** Round 0 could choose a provisional
   retained route at watermark 1, receive a server page at 40, then publish
   that route after an empty-footprint apply reached 40. Neither the table
   stamps nor the covering server cut rejected it. The new process-local
   publication floor records the watermark in the committed apply callback,
   before fallible follow-up work, and at `LocalReads.applied`. Every ordinary retained
   checkpoint and final publication proof requires the evaluation watermark
   to cover that floor. Missing evaluation metadata requires no floor advance
   since capture. Equal-watermark repeats coalesce. Store reset clears the
   floor under its existing hard barrier. No extra query await is added.

   Applies also select retained-sensitive watches through their static and
   actual dependencies, including purely local watches with no `changeCut` or
   `serverRead`. Opaque programs widen to all tables. These watches enter the
   existing resumption set even for an empty footprint, so catch-up reruns the
   route. The floor cannot bless rows or detect another process's unreported
   commit; the existing shared-store transaction checks remain intact.

2. **Queued prediction before admission.** Discovering a changed nonempty
   set of predictable, unobserved write identities/footprints now advances the
   hard evidence barrier. This includes unknown footprints and a second write
   to the same table, and retires a nonempty local candidate that reused an
   earlier pending check. Repeated reads of the identical queue do not advance
   evidence. A new evaluation of already predicted rows remains allowed.
   Admission and settlement retain their existing unconditional fences.

3. **LLP alignment.** LLP 3000.016 §2.2, 3000.023 §10 and 3000.028 §3.2 now
   state these exact rules. The stale explicit-empty-notification sentence
   now distinguishes an advancing empty list (unknown) from a quiet empty
   poll (no evidence). The apply rule names staged snapshots explicitly, and
   older claims about no tracked publication watermark are scoped to memory
   and detached-owner reconciliation rather than the new routing fence.

Immediate scope withdrawal, membership loss, revocation, prediction admission,
store replacement, unpublished cuts, independent local/server composition
proofs and unaccounted watch-version fences remain in place.

### Deterministic evidence

Five new cases failed against round 0: positive, empty and structured retained
routes with catch-up inside final publication; and known/opaque queued
predictions against nonempty local data. The original 36 publication cases
passed in that negative control. Two real-device negative controls (process
and wasm, round-0 SDK) also published the pre-catch-up provisional route after
catch-up; both fail the added assertion. Logs are in `round1/`.

The final publication file has **43 cases**, including continuation after
publication, repeated equal watermarks, repeated identical queues and a second
prediction to the same table. Four real-device regressions cover the late
route/delivery interleaving and the purely local retained watch's empty-apply
wakeup on both hosts. The late test parks the first queue read after
`pendingRoute` has read device state, applies an actual published page with
`touched: []`, then releases publication. Its first delivered page must use
the new route and all post-catch-up pages must be complete.

### Three paired idle remeasurements

Same LU three-browser fixture, **1,000 historical posts**, unfollow/refollow
before every measured write, 30 writes per cell per SDK run. Pairs alternate
**R0→R1, R1→R0, R0→R1**. R0 uses the frozen qualified round-0 SDK; R1 uses
the current compiled SDK. Both have the same diagnostic instrumentation and
unchanged native server/wasm. Each write measures the slower of two remote
React renders from the server commit. All six runs completed without browser
errors. These are loopback fixture measurements, not a service guarantee.

| Pair | Round-0 idle repost p95 | Round-1 idle repost p95 |
| --- | ---: | ---: |
| 1 | 105.3 ms | 121.0 ms |
| 2 | 126.5 ms | 113.8 ms |
| 3 | 84.0 ms | 96.0 ms |
| Pooled, 90 writes per revision | 105.3 ms | **106.2 ms** |

The final pooled median is **52.7 ms** and maximum **147.3 ms**. The
starvation fix remains comfortably below the 500 ms target. Pooled idle
message p95 is 91.4→87.4 ms; reaction is 70.1→75.3 ms. This short round does
not establish zero tail regression, or repeat round 0's heavy and ordinary
controls. Astra's browser-tail caveat and the round-0 report's limits stand.
Per-update stage stamps and each cell's summary are retained under `round1/`.

### Qualification and custody

Ten confined hog repetitions pass: **6,620 cases (662 each)**, zero failures,
cancellations or skips. All three owned hogs were reaped before starting the
full suite. The 23-file selection adds the five authority files to round 0's
18-file observation/publication/routing/RH/live/boundary set. The full suite passes in **2,292 seconds**, with **zero failures**: 5,002 Rust
tests + 17 doctests, nine fixture checks, 6,326 client passes across 318 files,
and 79 final model cases. Existing 33 Rust ignores and 11 client skips are
unchanged. The supervising disk sampler records 2,315.8 seconds because its
final completion poll runs on a 30-second cadence. No test count, timeout or
workload was reduced. `round1/qualification.json` contains the per-repetition
counts, full-suite phase results, log hashes and CPU records.

The full build reproduces **2,117,335 B raw / 639,810 B gzip** wasm under the
unchanged **639,940 B** ratchet, preserving the **130 B macOS allowance**.
All **238 compiled SDK files** match the frozen uninstrumented measurement
input. Product source hashes also match those recorded before measurement.
The sampled whole-worktree disk peak is **18.83 GB**, below 40 GB. Each
committed round-1 artifact is below 256 KiB. The final LLP reference check
passes with 527 documents, 10,379 references and zero errors. Nothing was
pushed or published.

Only eb1000 (`expose-builder-pixel`) and this worktree were used. The browser
mask was `17-19,23-24,65-67,71-72`, five idle physical pairs; stress groups
use `2-3,50-51`, `29-30,77-78`, and `38-39,86-87`, each with its own hog.
All pairs, including SMT siblings, were checked idle before launch. LU's
seccomp affinity wrapper confines descendants, including Chromium threads.
Each browser run and the two later stress groups have sampled thread-mask
audits; the first stress group's sample occurred after exit, so its custody
is the enforced affinity plus the driver's per-repetition hog checks.

Reproduce from `snapback4/` after building the package:

```sh
python3 reports/20261004-op-observation-publication/trace-sdk.py r1-final
python3 reports/20261004-op-observation-publication/round1/measure-pairs.py
OP_STRESS_FIRST=1 OP_STRESS_LAST=10 taskset -c <four-idle-CPUs> \
  python3 reports/20261003-lu-live-update-latency/tools/confine.py \
  python3 reports/20261004-op-observation-publication/round1-stress.py
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=12 \
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
  LU_TEST_CPUS=<two-CPUs-within-mask> taskset -c <checked-idle-mask> \
  bash scripts/test.sh
```

The measurement replay requires the recorded round-0 frozen SDK and native
instrumented server under `target/op` / `target/lu-op`; update its fixed CPU
mask only after checking the selected CPUs and their siblings are idle.
Raw traces, logs and frozen SDKs remain under `target/op/round1` and
`target/op/sdk-r1-final`. `round1/evidence.json` records their hashes and
recomputes pooled browser statistics. The original round-0 evidence was not
rewritten.

## Round 2 — overtaken queue discovery (2026-10-05)

Follow-up to `a759ded99a` after Grok READY and Astra READY WITH CHANGES (one
Low). The only product change is the prediction discovery fence in
`LocalReads.readQueued`; routing, retained-watermark checks, publication proofs,
retry timers and admission behavior are unchanged.

### Cause, parity and correction

A nonempty local candidate has already evaluated and read its pending state.
A later queue read starts, then a sequenced disjoint notification, published
empty-footprint commit, or `applied()` advances the authority revision. The queue
read returns a newly discovered predictable, unobserved write. Round 1's
revision check skips `queued()` entirely, including its prediction fence. The
unchanged-input proof then lets the pre-prediction local answer publish. Unknown
prediction footprints have the same failure.

**This restores pre-OP main's protection for the overtaken path.** At
`ed327e5dc7`, `readQueued` also skipped installing an overtaken snapshot, but
`evaluateLocal.checkpoint` unconditionally rejected any authority revision
change. Round 0 introduced disjoint-evidence survival without moving prediction
discovery outside that installation guard. The six overtaken cases all pass
against the frozen pre-OP SDK, fail against round 1, and pass after this fix.
The [parity log](./round2/pre-op-parity.log) uses Astra's reproducer with only
the new proof-hook lookups made optional for the older SDK. This parity claim
is specific to the six overtaken cases; round 1 also fixed discovery without
intervening evidence.

Every completed queue read now calls the shared `fencePredictions` helper.
The revision comparison is captured **before** discovery can advance evidence,
and controls only installing cached prediction state and notifying existence.
Stale empty and nonempty snapshots cannot overwrite newer cached state.
Successive identical prediction sets coalesce, including overtaken reads;
different out-of-order snapshots may conservatively fence again. A fresh local
evaluation can still publish the actual predicted rows. No await was added.

The queue-path audit covered `local.ts`'s sole queue wrapper, initial recovery,
receipt batching and retry/settlement helpers, `FollowingIntents.pending`,
`evaluateLocal.pending`, and the final one-shot queue check. All use
`LocalReads.readQueued`. Its hard evidence retires both local-input and server-cut
proofs; the ordinary publication loop, expiry re-evaluation, live rerun and final
`publishLocal` callback check those proofs. Synchronous admission, cold-read
control and settlement retain their existing fences. LLP 3000.016 §2.2 and
3000.023 §10 now distinguish discovery from snapshot installation; LLP 3000.028
§3.2's retained routing rule is unchanged and remains applicable.

### Deterministic and load evidence

Astra's [reproducer](./round2/astra-overtaken-queue.test.mjs) gives six failing
overtaken cases and two passing no-overtaking controls on round 1; all eight
pass with the fix. The checked-in regressions add:

- Twelve real-device cases: three evidence boundaries × known/opaque footprints
  × process/wasm. The device evaluates a nonempty page, another caller admits a
  real prediction, and a latched queue reply crosses the chosen evidence event
  before delivery. All twelve fail at the stale-publication assertion on round
  1. After the fix, all withhold the old value and then publish the actual
  predicted rows on reevaluation. Opaque mode omits footprint metadata from the
  real queue reply to exercise compatibility with an unknown footprint.
- Eighteen evaluator cases cover those six interleavings at ordinary
  publication, expiry retry and the final caller continuation.
- One control checks stale empty/nonempty queue-state protection, repeated
  discovery coalescing, and later successful snapshot installation.

The two publication files pass **76 cases**, including all existing starvation,
authority, composition and retained-watermark controls. SDK build/typecheck
and reference validation pass. [Negative real-device log](./round2/negative-live.log),
[negative evaluator log](./round2/negative-unit.log),
[positive publication log](./round2/positive-focused.log).

Ten hog repetitions pass **7,610 cases** (761 each), with zero failures,
cancellations or skips. The selected 29 files include observation, publication,
prediction, routing and live tests plus the retained-history and authority
controls from round 1. Each group has four confined CPUs and its own hog;
three groups run on disjoint physical cores. All three hogs remained alive for
their repetitions and were reaped on completion. The full suite is **not repeated**:
the product change is confined to the fence, as permitted by the round-2
instruction. The full round-1 suite remains historical evidence above.

One LU three-browser idle run uses 1,000 historical posts, unfollow/refollow
before every write, and 30 trials per shape. The reported latency is the slower
of the two remote React renders for each write:

| Cell | p50 | p95 | Maximum |
|---|---:|---:|---:|
| Idle repost | 55.8 ms | **104.7 ms** | 123.9 ms |
| Idle message | 63.4 ms | 94.5 ms | 102.3 ms |
| Idle reaction | 51.3 ms | 80.4 ms | 80.4 ms |

Repost remains below the 500 ms target; round 1's pooled repost p95 was
106.2 ms. Repost evaluation-to-observation-publication p95 is 12.5 ms and
observation-publication-to-render p95 is 1.3 ms across the 60 receiver samples.
This single repeat confirms continued progress; it is not a paired browser-tail
nonregression claim and does not repeat heavy/ordinary latency controls.
[Summary](./round2/idle.summary.json), [per-update stamps](./round2/idle.stamps.csv).

### Reproduction and custody

Run from `snapback4/`; the qualification driver samples `/proc/stat` for three
seconds, checks SMT siblings, selects eleven idle physical cores, and confines
all stress and browser descendants with LU's seccomp affinity wrapper:

```sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
python3 reports/20261004-op-observation-publication/trace-sdk.py r2-final
python3 reports/20261004-op-observation-publication/round2/qualify.py
python3 reports/20261004-op-observation-publication/round2/collect.py
```

The browser input is a frozen SDK with diagnostic hooks only in its copied JS,
and the retained instrumented native server `target/lu-op`. The selected masks
and sampled idle load are in [idle-qualification.json](./round2/idle-qualification.json).
Raw traces, logs and the clean frozen SDK remain under `target/op/round2`;
the measured copy is `target/op/sdk-r2-final`. The collector records hashes,
test counts, affinity audits, cleanup, wasm parity and sampled disk use in
[qualification.json](./round2/qualification.json).

All **238** rebuilt SDK files match the clean frozen input. Affinity audits
found only the selected thread masks for each group. Sampled disk peak was
**18,872,057,110 B (18.87 GB)**, below 40 GB; every stored artifact is below
256 KiB. No test count or timeout was reduced.

Wasm is byte-identical to round 1: **2,117,335 B raw / 639,810 B gzip**, measured
with the same filename-bearing `gzip -9 -c` convention. The **639,940 B** budget
and **130 B macOS allowance** are unchanged; no macOS measurement is claimed.
Only eb1000 and this worktree were used. The ticket remains resolved; nothing
was pushed.
