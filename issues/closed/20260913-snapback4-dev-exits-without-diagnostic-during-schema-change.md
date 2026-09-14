# Snapback 4: the dev server exited twice without a diagnostic during a schema change with a backfill

Status: Closed — fixed in Lane D's working tree, awaiting lead landing (2026-09-14)
Priority: P2
Date: 2026-09-13
Systems: `snapback4 dev`, schema adoption, jobs (backfill chunks), the HTTP host
Observed version: published `snapback4@0.2.6`
Evidence status: reproduced on 0.2.6 and base 0d7b77bb3c577366ac81bf159e57524c613c9e12; cause and fix established

## Problem

During the 0.2.6 three-model Clique run, the Astra lane's scale instance (a
`snapback4 dev` process on a fresh store, mid-replay at the 50% checkpoint)
exited twice while the builder changed the schema (splitting a public repost
counter into a dedicated `repostEdges` source) and ran the backfill that
followed. The builder's log records "scale server PIDs 62515 and 62517 exited
without diagnostic during schema change/backfill; restarted same store, no
reset" and its essay says "A server exit during the schema transition had no
diagnostic, so its cause remains ambiguous." The restarted server on the same
store continued the replay to completion, so no data was lost, but a process
that exits with nothing on stderr cannot be attributed, and a builder cannot
tell a crash from a signal.

## Evidence

- `~/clique-sb4-20260913-full-3models/lanes/astra-snapback4/run-log.md`,
  the entry at epoch 1789332946 (`error source=diagnostic attribution=ambiguous`).
- `~/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-instance-server.log`
  and `evidence/scale-counter-backfill-scale.json` (the builder's named evidence).
- `benchmarks/runs/2026-09-13-snapback4-clique-0004/astra/run-log.md` (the
  verbatim copy) and `astra/essay.md`.

## What to establish

1. Whether the process died by a panic that reached no log (a panic in a
   thread other than the request thread, or a `panic=abort` build printing
   nothing under the lane's redirection), by a signal from the host, or by an
   exit path of `dev`'s watcher on a schema adoption that fails mid-backfill.
2. Whether a schema adoption that starts a backfill job while the scale replay
   holds the engine mutex can wedge or abort the process (the memory-store and
   SQLite paths differ; the scale instance was SQLite).
3. Whatever the cause: every exit path of `dev` and `serve` prints a one-line
   diagnostic with a stable `SNAPBACK4_`/`E_` code and the generation it was
   serving, so an unattended exit is attributable from the log alone.

## Context

Recorded while revising LLP 3000.007 (§8.12): "sail through" includes not
dying silently. The `dev` watcher's adoption path and the job runner's
chunk loop are the places to look; the simulator's kill-at-any-await fault
covers the engine but not the host process's own exit paths.

## 2026-09-14 — resolution (Lane D)

**Cause: SIGBUS from SQLite shared memory, not a Rust panic or an explicit
watcher exit.** The local macOS report
`~/Library/Logs/DiagnosticReports/snapback4-2026-09-13-135501.ips`
identifies the original PID **62517**, parent **62515**, capture time
`2026-09-13 13:55:01.7811 -0700`, exception `EXC_BAD_ACCESS`, signal
`SIGBUS`, subtype `FS pagein error: 22 Invalid argument`, and a fault in a
writable **32,768-byte mapped file**. The raw builder transcript and
`scripts/start-isolated.mjs` establish that those two PIDs are the Node
launcher and its binary for one launch. They do not establish two separate
binary crashes. The crash report supplies the missing status for that launch.

`Store::open` tightened the database/WAL/SHM permissions by opening and
closing raw descriptors, including **after** SQLite had acquired its SHM
dead-man lock. POSIX drops a process's locks on an inode when *any* of its
descriptors for that inode closes. Another SQLite process (the CLI backfill)
could therefore see no surviving SHM owner and truncate the WAL index while
`dev` still mapped it. SQLite's own Unix VFS documents this exact close/lock
rule and the truncate-on-unowned-DMS protocol. An engine mutex cannot protect
against a second process discarding this mapping.

The fix changes `private_fs::existing_file` to tighten permissions by path
without opening/closing the inode. `database_file` creates a missing database
with 0600 and handles an existing database without a raw descriptor; the
store-opening call uses it. Directory ownership, regular-file/symlink checks,
SQLite transactions, the engine write path and all ceilings stay as before.
The regression checks the live SHM DMS/write and database shared locks from
an independent process, as well as the 0600 permissions and symlink refusal.

**Reproduction:** seven fresh SQLite-store attempts, projecting the retained
Clique `scale.log`'s post and set-repost actions into **49,200 feed entries**.
At **24,600 entries**, the watcher replaces the public counter over all entries
with `repostEdges` and its maintain; replay and HTTP queries continue while a
separate `run backfillRepostEdges --json` executes. Both base attempts and
both published 0.2.6 attempts died with SIGBUS: **4/4**. The first published
attempt's detector looked on stderr for adoption, but 0.2.6 printed that line
on stdout; its retained stdout confirms generation 2, and the corrected
detector's repeat also crashed. Three fixed attempts completed: **3/3**, no
request failures, server still serving; each backfill wrote **1,000 rows**.
Fixed walls were **9.237, 10.765, 9.143 seconds**, including seeding, adoption,
backfill, reads and cleanup. The unchanged-base failures took **5.734 and
7.512 seconds**; the corrected 0.2.6 attempt took **3.049 seconds**. This is a
focused reproduction, not a replay of all 167,157 app/auth/media actions.
Local commands, fixtures and logs are retained under `/private/tmp/lane-d/`.

**The other hypotheses:** the watcher serializes adoption behind replay;
maintenance releases the engine between chunks. The new test verifies this
on both memory and file-backed stores, then completes the backfill. A real
dev regression commits **200 chunks**, parks a backfill on its program's
refusal, keeps serving, adopts the corrected schema and completes the job.
Invalid source keeps the old generation. No deadlock or explicit exit was
found on these paths. An initial watcher timestamp race discovered by the
tests is also fixed: it now starts with the stamp sampled before compilation,
so an edit just after the listening URL cannot become its unnoticed baseline.

**Exit attribution:** `dev` and `serve` install a process-wide panic hook and
signal handlers before startup work. The current generation is atomic, so
reporting never needs the engine mutex. Lines use an unbuffered `write(2)`;
signal reporting uses a fixed stack buffer, no allocation, and preserves
errno. Catchable terminating/fatal signals are named. Without an app worker,
signals preserve immediate OS termination; with a worker, INT/TERM/HUP print
immediately, clean up that child and exit 128 + signal. An unexpected watcher
or maintenance exit is reported and ends the server. Tested line forms:

```text
SNAPBACK4_EXIT verb=dev generation=0 status=1 reason="no snapback/schema.q here or above; run `snapback4 init` to start one"
SNAPBACK4_EXIT verb=serve generation=0 status=1 reason="a deployment directory is required"
SNAPBACK4_EXIT verb=dev generation=7 status=0 reason="server loop returned"
SNAPBACK4_PANIC verb=dev generation=7 thread="watcher" action=unwind reason="injected\npanic" location=crates/snapback4/tests/lifecycle.rs:116:102
SNAPBACK4_THREAD_EXIT verb=dev generation=7 thread="watcher" reason="panic"
SNAPBACK4_THREAD_EXIT verb=dev generation=7 thread="watcher" reason="unexpected return"
SNAPBACK4_THREAD_EXIT verb=dev generation=7 thread="watcher" reason="shutdown"
SNAPBACK4_EXIT verb=dev generation=7 status=1 reason="watcher thread stopped"
SNAPBACK4_SIGNAL verb=dev generation=2 reason=SIGTERM signal=15
SNAPBACK4_SIGNAL verb=serve generation=1 reason=SIGBUS signal=10
```

Returned listener/startup errors use the same EXIT line with their exact
escaped reason. Panic location and thread are the actual call site; an abort
build says `action=abort`, followed by the SIGABRT line. Signal numbers are
the host's (SIGBUS is 10 on macOS). Tests also provoke a real truncated-mapping
SIGBUS while holding a mutex, off-thread panics under unwind and abort, all
three cleanup signals without a worker in both verbs, and worker cleanup.
SIGKILL, power loss, and a closed/unwritable stderr cannot be reported from
inside the process; no guarantee is made for those cases.

Validation: **11/11** CLI Rust lifecycle regressions; **8/8** compiled-guide
tests; **16/16** local-client/periphery tests. The final blocking suite took
**45 seconds**: **312 Rust passed, 0 failed, 1 ignored; 9 fixture tests
passed; 111 client tests passed, 1 failed**. The remaining failure is Chromium
SIGABRT before React assertions, reproduced alone and on a 60-file untouched
archive of base `0d7b77bb3c577366ac81bf159e57524c613c9e12` with Node 24.18.0.
The first two suite runs exposed an introduced no-worker signal shutdown
delay (a reused-port test could reach the exiting server); preserving the
original immediate termination fixed it. No client code or tests changed.
This is not a green sandbox full-suite claim; the lead reruns Chromium
outside. `./ref-check --verbose` is green.
