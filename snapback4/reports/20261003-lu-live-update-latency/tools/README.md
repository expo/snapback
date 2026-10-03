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
taskset -c 80-89 node reports/20261003-lu-live-update-latency/tools/measure.mjs

# After the baseline exits and its keeper reaps the burners, repeat with
# SNAPBACK4_BIN=target/lu-after, LU_LABEL=after and a distinct LU_OUT.

node reports/20261003-lu-live-update-latency/tools/finalize.mjs \
  target/lu-before-qualified.json target/lu-after-qualified.json
```

Choose CPUs appropriate to the host; these examples name this lane's assignment.
The harness refuses an affinity wider than 16 CPUs. All descendants inherit it.
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
