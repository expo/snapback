# Reproduction method

The worktree began at `38abb89b8e0b206644b9e2619c6f2d159a981d23` on
`sb4-intent/sl-suite-under-load`, with no dependencies or build artifacts.
`environment.json` records the toolchain and inherited Cargo inputs.
Dependencies were installed with `taskset -c 80-95 bun install --frozen-lockfile`.

## Containment correction

The initial idle, moderate and heavy runs inherited taskset's CPUs **80–95**.
Snapshots during heavy testing found no escaped threads. A later thread-level
snapshot during the original slow-start run, however, found 16 threads of child
1346483 on CPUs **0–15**. That child exited before its executable could be read.
The run and its queued diagnostics were stopped; the tracer's EXITKILL reaped
its descendants, and no live non-zombie process remained from the last audit.
The partial client output is retained separately. This is an **SL harness
failure**, not a product-test failure. Initial taskset-only runs are diagnostic
evidence, **not confinement-qualified runs**; snapshots cannot retrospectively
prove that other worker pools never reset their masks.

The user manager has no delegated cpuset controller. A transient scope's
`AllowedCPUs` setting did not prevent a small control from broadening its mask,
so it is not used. No machine-wide cgroup configuration was changed.

Subsequent confined runs apply `taskset -c 80-95`, then `confine.c`, before
starting the suite or a load worker. The local guard verifies that exact mask
and installs an inherited seccomp filter refusing `sched_setaffinity` (x86-64,
x32 and i386). It affects only this process family; no existing process is
attached or reconfigured. A parent, child and thread control each proved that
broadening returns EPERM and the 80–95 mask remains intact. Thread snapshots
remain supplementary evidence, recorded in `affinity-audits.jsonl`.

## Workload and concurrency

No CPU priority change, seed/count override, file skip, Rust-pool override or
client serial override is used in whole-suite runs. On this affinity the
publication rules select 16 Rust processes and five client-file slots. The two
model files keep their separate serial stage. `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`
matches publication. The initial idle run includes a cold build; later runs
reuse this worktree's artifacts but execute the entire suite.

`busy.c` is a constant-memory CPU loop. Build the experiment helpers from
`snapback4/`:

```sh
mkdir -p target/sl-load
taskset -c 80-95 cc -O2 -Wall -Wextra -Werror reports/20260929-sl-suite-under-load/confine.c -o target/sl-load/confine
taskset -c 80-95 target/sl-load/confine cc -O2 reports/20260929-sl-suite-under-load/busy.c -o target/sl-load/busy
taskset -c 80-95 target/sl-load/confine cc -O2 -Wall -Wextra -Werror reports/20260929-sl-suite-under-load/slow-exec.c -o target/sl-load/slow-exec
```

`run.py NAME 16` starts sixteen workers (moderate); `run.py NAME 48` starts
forty-eight (heavy). It records their PIDs and actual affinity, runs the entire
`scripts/test.sh`, then terminates and reaps exactly those owned workers.
`run.py NAME 0` injects no busy workers. No other lane's processes are stopped.
All final qualification cells must use the corrected guard. Heavy-run metadata
also records that every busy worker is alive immediately before cleanup and
records its accumulated CPU time; an early worker exit invalidates the load
condition even if product tests pass. `load-progress.jsonl` retains supplementary
worker snapshots for the moderate run, which began before that final accounting
was added.

## Slow executable startup

The initial, aborted `baseline-slow` used `strace -f --seccomp-bpf` with a
300 ms exit delay on descendant `execve`/`execveat`. It changed no syscall
return value and covered static and environment-cleared executables, but also
delayed failed PATH attempts. Despite an installed filter, it added substantial
runtime tracing overhead: a Rust-stage snapshot showed 47 million context
switches in one thread and the tracer had consumed 13m52s CPU over 20m47s.
That run's 1744-second passing Rust stage is not a measurement of startup cost.
Its wrapper arguments and raw-pointer trace are retained as exploratory evidence.

The corrected `run.py NAME 0 slow` uses `slow-exec.c`: `PTRACE_SEIZE` follows
only this wrapper's pipe-gated child family, observes successful exec/fork/clone
events and resumes ordinary execution with `PTRACE_CONT`. Each successful
child exec waits **300 ms** on a monotonic deadline. The root's first exec is
not delayed. Failed PATH attempts and forks without exec receive no scan delay.
There is no per-syscall tracing. `PTRACE_LISTEN` preserves actual group stops;
EXITKILL prevents leaked children if the wrapper is terminated. Trace records
contain PIDs/times, never executable arguments.

`wrapper-controls.json` records successful controls: two child execs took
0.614 s; an environment-cleared exec took 0.331 s; real stop/continue, exit code
7 and SIGTERM status were preserved. A 200,000-getpid control took 0.140 s bare
and 0.142 s wrapped in that run. These small controls validate the wrapper's
mechanism, not suite performance. The affinity guard wraps the tracer too.

## Records and limits

The final `run.py NAME 0 unconfined` removes taskset, the affinity guard and load
generation, retaining publication build inputs and the entire script.
Diagnostic controls may supply `-- COMMAND...`; these are explicitly focused
runs and do not substitute for whole-suite qualification. Each run records
its command, source HEAD/diff digest, harness binary digests, elapsed time,
exit status and full stdout/stderr. Starting with the rate-clock focused check,
the runner also compares the tested source diff before and after execution; a
change invalidates a nominal pass. `summarize.py` preserves every failure block,
asynchronous post-test error, exact stage/overall summary and raw-log digest.

After all final cells complete, `python3 reports/20260929-sl-suite-under-load/validate-evidence.py`
checks the source digests, complete inventories, three distinct heavy passes,
all 48 workers surviving each heavy run, startup-delay trace, whole guide and
unconfined final run. The inventory check requires 16 visible CPUs with 16 Rust
process slots and five client-file slots in confined suites, versus 96 CPUs
with 24 Rust and 24 client slots in the final unconfined suite. It writes `qualification.json` only after every condition
passes; the record also lists unsuccessful whole attempts. This utility reads
existing logs and metadata and does not run or retry tests.

Historical logs were copied read-only from the black M5 (attempts 1, 3, 4)
and office M1 (attempt 2). No builds, tests, simulators or load generators were
run on either Mac. Attempt 4 ends at the client stage's start, so it supplies
Rust failures but no whole-suite completion claim. Those inventories differ
from this checkout and are diagnosis evidence, not Linux qualification.

The inherited nominal 60-second complete-suite budget remains exceeded. The
script reports actual elapsed time; these runs do not claim that budget is met.
No publication concurrency or model/sample count is reduced to meet it.

This experiment controls CPU contention and executable startup. It is not a
Darwin reproduction or an artificial memory-pressure test. Inherited ignored,
platform-only and opt-in cases retain their original conditions and are not
claimed as executed on Linux.


A supplemental read-only cleanup snapshot is retained in
`parent-1-audits.jsonl`. At 2026-09-30 08:24:15 UTC it found no non-zombie
parent-1 processes whose affinity was wholly within CPUs 80–95. This is a
point-in-time orphan census, not a substitute for the inherited affinity guard
or proof of ownership from a PID alone. No process was stopped by that census.
