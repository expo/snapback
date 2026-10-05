# Reproducing LU

Run from `snapback4/` on Linux with Node 24, Python 3, Rust and headless Chromium.
Install locked dependencies, build the wasm and client package first, following
`snapback4/AGENTS.md`. The fixture uses the shipped `webDevice()`, local client,
IndexedDB and React hooks; it does not call a private query evaluator.

Build each measured revision with `taskset -c <build-cpus> python3
reports/20261003-lu-live-update-latency/tools/instrument.py before` (or `after`).
The helper temporarily instruments the server, builds the production profile,
copies `target/lu-before` / `target/lu-after`, and restores every source in a
`finally` block. Run it sequentially with other builds and source edits. For a
baseline checkout, copy this tools directory into the same relative location.
The actual baseline revision is recorded in the report.

```sh
SNAPBACK4_BIN=target/lu-before LU_LABEL=before \
LU_RUNS=20 LU_HISTORY=1000 LU_REFOLLOW=1 LU_LEVELS=0,20,120 \
LU_OUT=target/lu-before-qualified.json \
taskset -c 80-89 python3 reports/20261003-lu-live-update-latency/tools/confine.py \
  node reports/20261003-lu-live-update-latency/tools/measure.mjs

# After the baseline exits and its keeper reaps the burners, repeat with
# SNAPBACK4_BIN=target/lu-after, LU_LABEL=after and a distinct LU_OUT.

node reports/20261003-lu-live-update-latency/tools/finalize.mjs \
  target/lu-before-qualified.json target/lu-after-qualified.json
```

Choose CPUs appropriate to the host; these examples name this lane's assignment.
The harness refuses an affinity wider than 16 CPUs and requires `confine.py`.
That unprivileged launcher freezes the inherited taskset mask with seccomp;
Chromium software-GPU workers otherwise reset their mask to CPUs 0–N. The
launcher self-tests denial of affinity changes before exec, and descendants
inherit both mask and filter. No rendering flags are changed.
`LU_LEVELS` names **process counts**, not reported whole-machine load: 120
permanently runnable workers on ten CPUs supply twelve workers per CPU. They
live in a new process group owned by a keeper; closing its stdin terminates and
reaps that group. No pattern-based process signaling is used. Whole-machine
load and confined CPU counters are both recorded; another tenant can keep CT's
global load hint active even with zero injected workers.

There are three independent browser contexts: writer Alice and receivers Bob
and Carol. Each runs all three views. Refollow mode unfollows and refollows Bob
before **each** measured write, while history supplies older work to service.
Setup drains initial work before browsers start; no measured update explicitly
syncs or advances the clock. For a steady-state control use `LU_RUNS=30
LU_HISTORY=0 LU_REFOLLOW=0`, with the same load levels and CPU assignment.

The suite test uses `LU_SUITE=1` and an ordinary debug server. Its proxy adds the
existing CT request-trace header to recover post-commit time without adding
shipping instrumentation. `LU_TEST_CPUS` selects its two-CPU assignment; this
lane uses `90-91` while formal measurements occupy `80-89`.

`.json` contains compact samples and load counters. `.json.jsonl` streams full
per-update events and can grow beyond a gigabyte; keep both under ignored
`target/`. `finalize.mjs` streams that evidence to a compact summary and timestamp
CSV. Do not commit raw files above 256 KB, compressed traces or movies.

All stage timestamps use Unix milliseconds on one host. A query can acquire
the new cut before a long poll returns; notices, sync and queries overlap.
For reposts, “delivery” is the fresh item's final follower-copy commit, not the
end of historical backfill. For messages and reactions the source commit is
the relevant delivery. `received` is the first decoded change, sync or query
response proving the delivery cut; the separate long-poll timestamps can arrive
later. A recipient may already have its copy before the final fan-out cut,
leaving that cut's receipt absent at its render. HTTP query completion is recorded when the browser has
decoded the body, so its duration includes transport and scheduling. The older
baseline wrapper did not stamp matching server-fallback rows explicitly;
replay uses its last recorded corresponding query response at/above the source
sequence before the matching observation. Missing stages remain missing.

Percentiles use nearest rank. The primary latency statistic first takes the
slower of the two remote renders for each write, then calculates percentiles;
stage statistics pool both receivers. Wasm, IndexedDB and device durations
are interval unions clipped to commit-to-render and overlap each other. Do not
sum these spans or interpret their wall durations as CPU time. The report
qualifies this platform fixture, not a replay of the frozen calibration app.

## Round 1

Use the original FIFO revision `7c9c0c0dabb0528cdee438222bb7eec46e828f16`
for `r1-before` and the round-1 commit for `r1-after`. Both use the current
measurement wrapper and 30 writes per shape/load. The baseline build in this
lane temporarily restored the four production files changed by round 0
(`engine/mod.rs`, `engine/timeline.rs`, `engine/timeline/work.rs`, and
`serve_maintenance.rs`) to that base, instrumented/built, then restored the
candidate in `finally`. Separate worktrees at the named revisions are equivalent.

To keep the same client bundle while the suite rebuilds the package, copy the
**package layout**, including its import map (copying `dist` alone loses `#fetch`):

```sh
mkdir -p target/lu-r1-sdk
cp packages/snapback4/package.json target/lu-r1-sdk/
cp -R packages/snapback4/dist target/lu-r1-sdk/dist
SNAPBACK4_BIN=target/lu-r1-before LU_SDK=target/lu-r1-sdk/dist \
LU_LABEL=r1-before LU_RUNS=30 LU_HISTORY=1000 LU_REFOLLOW=1 \
LU_LEVELS=0,20,120 LU_OUT=target/lu-r1-before.json \
taskset -c 80-89 python3 reports/20261003-lu-live-update-latency/tools/confine.py \
  node reports/20261003-lu-live-update-latency/tools/measure.mjs
# After it exits, substitute r1-after for r1-before (keep the same LU_SDK).
node reports/20261003-lu-live-update-latency/tools/finalize.mjs \
  target/lu-r1-before.json target/lu-r1-after.json
```

While a run is active, `python3 tools/audit-affinity.py ROOT_PID 80-89`
(from this report directory) samples its processes and threads and refuses
any mask mismatch. Use the measurement Node PID, not a process-name kill or
an unrelated browser. For the suite witness the expected mask is `90-91`.
The filter enforces inheritance continuously; this read-only audit independently
checks observed live threads, including the software GPU pool.

## Round 2

The exact pre-LU control is `848b645294^1` (`4353aa735c`); round 2 merged
main at `2cc55e168c`. Build native replay/upload probes in each checkout without
changing their timeouts. Run from `snapback4/`, with separate output labels:

```sh
taskset -c 0-31,48-79 python3 reports/20261003-lu-live-update-latency/tools/replay-build.py \
  /path/to/prelu/snapback4 target/lu-r2/prelu
taskset -c 0-31,48-79 python3 reports/20261003-lu-live-update-latency/tools/replay-build.py \
  "$PWD" target/lu-r2/main
LU_LABELS=prelu,main LU_RUNS=5 LU_UPLOAD_RUNS=10 LU_LEVELS=0,20,120 \
LU_TAG=prelu-main \
taskset -c 80-89 python3 reports/20261003-lu-live-update-latency/tools/confine.py \
  python3 reports/20261003-lu-live-update-latency/tools/replay-compare.py
```

Use the actual candidate checkout for a distinct `final` label, then compare
`LU_LABELS=main,final` with `LU_TAG=main-final`. The retained `combined` label is
the initial candidate before the CPU-debt conservation correction. Choose a
new `LU_TAG` for each comparison to preserve
prior logs. `LU_FIFO=1` on `replay-build.py` builds the current-runtime ablation
that changes only the periodic selector to FIFO. Temporary instrumentation and
the selectable replay server path are restored in `finally`; never run another
build or edit sources concurrently in that same checkout.

The fixture creates no historical backfills. Each successful delivery trace
contains kind, cursor, work identity, committed sequence, timestamp and row
writes. Sum live-delivery writes minus the one Work update to locate the 900th
copy; a final task-retirement slice can occur later. Pause records are requested
repayment decisions, not measured scheduler sleep duration. Build/test logs and
individual traces stay ignored under `target/lu-r2/`. The report's compact JSON
retains per-trial statistics and raw-log hashes.

For the web sweep, build `lu-r2-main` and `lu-r2-final` with `instrument.py` at the
corresponding revisions. Freeze the same current-main package layout under
`target/lu-r2/sdk` after a locked wasm/package build. Use the round-1 command with
`LU_RUNS=30`, `LU_HISTORY=1000`, `LU_REFOLLOW=1`, `LU_LEVELS=0,20,120`, and distinct
`LU_OUT=target/lu-r2-{main,final}.json`. Keep `LU_SDK=target/lu-r2/sdk/dist` identical.

Round 2 additionally runs the unchanged `contended-reads.mjs --mixed` control
for 125 seconds on each production binary, with `--levels 0` and 120 **external**
keeper-owned burners on the same ten CPUs. Thus its internal `busy: 0` field
is not the actual injected load. This control covers reads, schedules, leases,
expiry and deadlines; it has no Following backlog. The replay and web fixtures
provide the separate live-delivery measurements. Run experiments sequentially;
the normal suite may run on CPUs outside their physical-core allocation.

Generate the compact native evidence (including turn/repayment counts cut at
the 900th copy, which may precede final task retirement):

```sh
python3 reports/20261003-lu-live-update-latency/tools/replay-summarize.py \
  reports/20261003-lu-live-update-latency/round2 prelu-main fifo-adaptive main-combined main-final
```

The report retains the final browser files as `web-after.*` (their metadata
names the `r2-final` binary), and the initial candidate as `web-initial.*`.
Independently reconstruct primary percentiles from those CSV stamps:

```sh
python3 reports/20261003-lu-live-update-latency/tools/check-stamps.py \
  reports/20261003-lu-live-update-latency/round2 main after
```

This records raw negative cross-clock intervals as findings rather than
clamping or removing them. Read `web-validation.json` as well as its percentile
checks; it is not an assertion that every server/browser timestamp forms a
single strictly ordered clock.
