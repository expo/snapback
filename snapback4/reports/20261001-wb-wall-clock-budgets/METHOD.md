# Reproduction and custody

The host is eb1000 (`expose-builder-pixel`), AMD EPYC 9454, 48 physical cores /
96 logical CPUs. Node 24.13.1 and Bun 1.3.14 are pinned. See environment.json.
The optional fleet file was absent on this host; SL's recorded host identity
and the local machine identity matched, so no remote dispatch was necessary.

Preparation: frozen Bun install; independent copy of an existing local build
cache, followed by builds in this checkout with publication SQLite flags;
wasm build; clean client build. Build/install logs are retained. `guide.log`
is the separate complete guide target. This is test qualification, not a
publication or a tarball/consumer qualification.

## Contention recipe

`busy.c` is SL's constant-memory uint64 arithmetic loop. Each repetition starts
48 such workers on exactly the same ten logical CPUs as its suite. The source recipe is [SL’s report](../20260929-sl-suite-under-load/REPORT.md). `confine.c`
checks a ten-CPU mask and installs SL's inherited seccomp filter refusing
`sched_setaffinity`; child libraries cannot expand their mask. Only these
recorded worker PIDs are stopped, and only after their suite exits. Each run's
JSON records start/end, exit, every busy PID, affinity, survival and CPU time,
source hashes, environment inputs and full command. A missing busy worker or
a changed test source invalidates the run.

Five repetitions run concurrently in **separate detached checkouts and
independent node_modules/build caches** made by prepare-runs.py. Their logical
CPU masks are 0–9, 10–19, 20–29, 30–39 and 86–95. The masks do not overlap;
on this SMT host the fourth/fifth sets share two physical cores, adding
contention. The other masks use distinct physical cores. This does not claim
exclusive host access. Each individual run has the requested 48-worker,
ten-CPU recipe; simultaneous runs do not share temporary projects or build
outputs. All five source manifests are identical at their starts. The initial snapshot
is source-manifest.json; source-manifest-final.json records the first corrective
snapshot, and source-manifest-repaired.json is the final snapshot after the
client timer and search fixture repairs. These historical manifests are never overwritten.
Current reproduction scripts use the repaired manifest.

Each run uses the published file-pool policy:
`max(1, min(24, floor(os.availableParallelism() / 3)))` = **3** ordinary file
slots under the mask. The affected session-model file then runs separately
with **5,000 sequences per tier**. No count/seed reduction, timeout environment
multiplier, serial override, runtime wrapper delay or scheduler-priority
adjustment is supplied.

```
cc -O2 reports/20261001-wb-wall-clock-budgets/busy.c -o target/wb-load/busy
cc -O2 reports/20261001-wb-wall-clock-budgets/confine.c -o target/wb-load/confine
python3 reports/20261001-wb-wall-clock-budgets/inventory.py
python3 reports/20261001-wb-wall-clock-budgets/prepare-runs.py
python3 reports/20261001-wb-wall-clock-budgets/heavy.py
```

`run.py NAME 48 -- COMMAND...` is the individual harness. `WB_RUN_ROOT` picks
an isolated checkout and `WB_CPUS` picks its ten-CPU range. The normal source
manifest includes newly added files, not merely `git diff`. The earlier pilot
predated that manifest check and is explicitly diagnostic: source changed
while it ran, and it found a conversion error. It is not one of the qualifying
unconfined runs.

## Scope of later verification

The final audit found one additional incidental elapsed-time assertion in
client-seams after the five isolated snapshots had started. Review also
restored the session model's logical 100-clock-step bound (it is a work bound,
not an incidental wall-clock timeout) and corrected a stale comment in
per-row-retry. Contention then exposed the inherited one-second initial-branch
cutoff in live-propagation-fallback; the original test reproduces the same
`initial answer is local` failure. An adjacent held-query cutoff was also made
explicit. The final audit also caught four 50 ms proxy completion guards and replaced
them with the common watchdog (intentional 5 ms timeouts stay). Two remaining two-second one-shot watchdogs and an 80 ms accelerated deadline
were also converted to guarded promises / an explicit entered-state trigger.
Further loaded failures exposed feed-silence, retention-clock, scheduled-job
setup, fixed-turn publication, worker diagnostic-pipe, idle socket, incomplete
replica acquisition, retired audit-token and completed exit-response races. Their fixture
changes are listed in FAILURES.md; late-tests.json is the exact final follow-up
closure. Each affected scope receives five complete additional
contention executions at their final bytes; unchanged files retain the
original repetitions. The first model-stage results are not credited as
qualification of the restored bound: after their ordinary stages completed,
only the recorded obsolete model processes were stopped. Node reports one
cancelled file wrapper per run, with its completed online tier also retained.
superseded-model-stops.json records those owned PIDs and the reason. Every final
model repetition still runs all 5,000 sequences on both tiers. The qualification ledger binds results
to file contents instead of pretending the earlier snapshot included these
last changes. The initial runs are not described as zero-failure invocations:
every superseded failure remains in the ledger. Final qualification
combines unchanged passing files with all five final executions of the changed
scopes. The first corrective runs exposed an introduced client-seams fixture
error: Node's broad timer mock altered active HTTP parser timers. The final
test instead holds delivery through the global API using real Timeout handles,
leaving node:timers intact. The process search aggregate also reached a guard
that counted one unit per seed despite multiple phases and extra histories;
its replacement counts that work explicitly. A generation-adoption race now
waits for the exact new program marker instead of an intermediate truncation
revision. repair.py reruns both complete files five times under
the same load after the ongoing runs finish. The four focused admission cases
also pass under load (zero-wait-real-timers.log), as does the affected search
seed on both hosts (search-69-corrected.log). The other corrective scopes,
including the full models, continue to completion and retain their evidence.
The unconfined converted-file run and the single full-suite run
use final source, after synthetic workers have stopped.

The complete guide command is:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide`.
The full-suite command is `bash scripts/test.sh` with the same SQLite build
input and no suite overrides. Run it once; preserve its literal final footer
and every failure. Do not mistake a wrapper or setup failure for a product test.

## Product mutation controls

controls.py creates a disposable copy of the built package and test. Only
that copy's `dist/local.js` is modified, immediately before `publishLocal` in
the `presentTransition` fallback returning `image-2`. A marker proves the
mutation was reached.

1. Delay publication 15 real seconds: the exact wasm test must pass. This
   exceeds the previous five-second loop while sync remains held.
2. Hold that publication until cleanup aborts the watch: the exact test must
   exit nonzero with the named `TEST_HANG` transition after its 124-second
   guard. The control runner has an independent 180-second watchdog.

Both use the actual product publication boundary, not a shortened test
watchdog. Patches, commands, original/mutant hashes and complete logs are
retained. The scratch product is restored after both controls. The main
checkout's product files are unchanged.
