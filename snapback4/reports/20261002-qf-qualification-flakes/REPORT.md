# QF — qualification flakes

Status: Round 3 complete: full suite 0 failures; both targets 200/200; two stress-background mechanism refusals retained below. No push or publication.

Round-0 baseline: `850fea99574d969331f68b0df1417ad1f942d2a9`, branch
`sb4-intent/qf-qualification-flakes`. Product sources match release `8e6246be14`;
only package/Cargo versions and locks differ. Node 24.13.1, Linux, 96 available
CPUs. Own binary: 0.4.11, SHA-256
`41f1af67d2190465b68144df0524f9cc1ece7e086b75ff6fefefd77bdb574933`.
The publication passed at 18:06:35Z; the exact guard released at 18:07:09Z.
Lane dependency/build preparation began at 18:07:28Z, after that release.
Early single-file development checks used the already-built publication 0.4.12
binary with identical product sources. Multi-file stress, the final focused
checks and the complete suite use this lane's own 0.4.11 binary above.

## Scope and governing context

Tests, fixtures and suite runners only. LLP 3000 (current),
`publication-suite-on-small-hosts` and `publication-suite-under-contention`
bind concurrency, full counts, state barriers and failure diagnostics.
LLP 3000.007 §9.2, LLP 3000.009 §§5.2–5.3 and LLP 3000.019 §3.6 describe the
worker's separate process, admission/retry and writer custody. The current
effects guide agrees. No product source change or contract change is needed.
The read-only llp-orient context used these documents; no new LLP is introduced.

## Worker cause and controlled counterexample

`serve.rs` prints the listening URL before starting background threads and
calling `Supervisor::start`. That function's initial `named()` admission may
fail the host. The original fixture returned at the URL, immediately wrote a
new declaration while its Node wrapper advertised v23, and could therefore
make that declaration part of initial admission. Repairing the wrapper cannot
restart an already exited host. The intended path is instead a source edit
after startup, which registers pending admission and retries after Node repair.

Source locations: `crates/snapback4/src/serve.rs` (URL at 340–369, then
`serve_requests`) and `crates/snapback4/src/dev_worker.rs` (`start`/`named`,
66–140; pending retries cap at five seconds).

A single-file control delayed `clone3` entry by 100 ms through `strace`, without
changing the server. It failed exactly the reported final `starts.length === 1`
wait after 122001 ms. New diagnostics showed `exitCode: 1`, empty worker status,
and `SNAPBACK4_EXIT ... worker needs Node 24` with no `declaration will retry`.
The same scheduling control passed after the fixture waited for a served
`GET /auth/config` response: 7.811 seconds. The pre-fix file plus diagnostics
is reconstructible from baseline and `before-diagnostics.patch`; the original
assertions and 122-second state guard are unchanged.

The permanent fixture regression holds initial Node admission after the URL
until an explicit release file appears and requires startup to remain pending.
The original restart test now also requires `declaration will retry` before
repair. Worker timeouts include the retained server log, process exit state,
worker status rows, start records without bearer tokens, and worker liveness.
Cleanup escalates after five seconds, before removing the fixture directory.

## Replacement fixture

Identity copy now uses one transaction across all three original tables,
retries only SQLite BUSY/LOCKED for at most five seconds, and closes the
replacement on every setup error including failed probe assertions. Both probe
assertions and every browser admission assertion remain. Regressions cover
successful retry after releasing a held writer, a held writer failing an actual
nested node:test process without a live child or hang, and probe failure cleanup.

## Suite containment

An independent runner gives ordinary files 15 minutes and model files 30
minutes. It covers blocked JavaScript and leaked handles after tests fail.
Process registration includes detached Node children and browsers; cleanup
captures descendants before terminating parents and compares start identities
against PID reuse. Timeout output names the file, bound, owned processes and
last 16 KiB of output. TERM grace is five seconds, KILL reap allowance two,
and process-tree inspection two. Tests cover a blocked event loop, an assertion
failure with a leaked detached child that ignores TERM, and continued execution
after an ordinary assertion failure, and an unreferenced detached orphan after
a passing body. No existing case or seed count is removed.

## Qualification

Single-file checks: all 61 worker tests passed in 440.609 seconds; all 55
browser admission tests passed in 132.092 seconds. Replacement regression:
3/3; watchdog regressions: 4/4. Removing only the HTTP readiness barrier makes
the new fixture regression fail its original readiness assertion (1/1 negative
control); the barrier passes. The two-minute scheduling control is an expected
pre-fix failure, not a qualifying test failure.

Natural load, byte-identical original worker fixture: **0/200 failures**.
The 23 background slots completed 386 files, covering all 283 ordinary client
files at least once; no load-file failures. This phase ran 18:10:25–18:20:29Z.
Slowest file: ordinary-search-oracle, 505.730 seconds; worker-regressions,
445.528 seconds. The 900-second ordinary-file guard leaves 394 seconds over that natural
baseline maximum (1.78×). The separate model guard is 1,800 seconds per file;
its final-suite measurements are recorded below.

The next controlled baseline's slowest background file took 513.743 seconds,
still below the same unchanged 900-second guard.

Natural load did not reproduce the worker failure. A separate controlled
schedule delays each target server's `clone3` entry by 100 ms under the same
23-slot client load; other servers are unmodified. This lengthens the legal
startup scheduling window at the already-proved URL/admission boundary. It
is a scheduling counterexample, not an estimate of the natural flake rate.
The controlled pre-fix run failed **1/1** after 122889 ms, with the same
exited-host diagnostics. The fixed fixture passed **200/200** under the identical
tracer wrapper, with all 23 background slots active at every target completion.
All **815/815** background-file executions passed, covering the complete
283-file ordinary inventory. This phase ran 18:54:28–19:11:05Z; the 200 targets
finished by 19:04:04Z and the remaining time drained in-flight load files. Target
elapsed times: min 2.799 s, median 2.883 s, max 2.927 s. These include the
injected scheduling delay and cleanup, and are not a product latency benchmark.
The final focused regressions and readiness-barrier negative control passed
their expected checks. The lost publication log prevents a unique retrospective
attribution of that historical run; this counterexample proves a fixture race
with exactly its observed wait.

| Condition | Worker failures/runs | Background files failed/completed |
| --- | ---: | ---: |
| Original fixture, natural 24-file load | 0/200 | 0/386 |
| Original fixture + diagnostics, controlled startup + load | 1/1 | 0/255 |
| Fixed fixture, identical controlled startup + load | 0/200 | 0/815 |

The one complete `scripts/test.sh` run, 19:11:23–19:35:29Z, exited **0** and
reported exactly:

```text
== 0 failure(s) in 1446 s
```

All build/type/documentation categories, 285 Rust test binaries / 998 target
executions plus doctests, both app typechecks and nine fixture-wrapper tests
passed. Ordinary clients: **283/283 files; 5,792 passed, 0 failed, 10 skipped**.
Full-count models: **79/79 passed**. Full-suite failures: **ours 0, baseline 0,
environmental 0**. No watchdog timeout or leaked-child failure occurred.
The ten existing conditional skips are five macOS-only cases and five cases
requiring separately supplied historical binaries/configuration; their exact
reasons are retained in `full-suite-skips.txt`. This change introduces no skip,
reduces no seed count, and weakens no admission assertion.

Affected files in that final suite: worker **61/61**, **440.567 s**; browser
admission **55/55**, **124.841 s**; replacement **3/3**; watchdog **4/4**. The
injected-lock test requires a genuine nested failure exit, no watchdog
intervention, a reaped replacement PID, and removal of its temporary project.
The readiness mutant fails its assertion with no watchdog intervention.

The slowest ordinary file across the three qualified load phases and final
suite was **513.743 s**, leaving **386.257 s** below the unchanged 900-second
ceiling (1.75×). In the final suite it took 493.801 s. Serial model file times
were **243.106 s** and **69.991 s**, each below the 1,800-second ceiling.
Cleanup uses a two-second process-tree inspection allowance, five seconds of
TERM grace, and two seconds to observe KILL completion. The file deadline is
outside the tested process, so blocked JavaScript cannot disable it.

`full-suite-summary.txt` retains category results, exact summary and full-log
SHA-256; `full-suite-files.tsv` records every file's counts and elapsed time.
`inputs.sha256` binds the tested fixture/runner sources and binary. All raw
working logs stay under `/tmp/qf-*`; committed evidence is compact and every
individual artifact is below 256 KiB. Reference validation passed: 525 LLP
documents, 10,106 references, zero errors or unchecked references.
`git diff --check` passed; tested source hashes remained unchanged through the
final suite, and no product source was modified.

## Reproduction commands and evidence custody

From `snapback4/`, after the host guard releases:

```bash
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --workspace
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs before /tmp/qf-before 1
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs after /tmp/qf-after 200
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh
```

Run the two phases separately; the expected pre-fix failure exits nonzero. The
harness gives the repeated target one slot and cycles all ordinary client files
in 23 other slots, draining current files before returning. Full model files
remain outside this reproduction load, exactly as in the ordinary client phase.
Only the repeated target uses the tracer. This preserves real browser, host,
SQLite and worker contention instead of using CPU burners as a proxy. The
controlled baseline used 255 different background files; the natural baseline
covered the entire 283-file ordinary inventory. No background case is filtered.

The wrapper uses `strace -I 2 --kill-on-exit -f -e trace=clone3` and an injected
100 ms entry delay. An independent thread-creation check measured 101 ms and
marked the syscall `(DELAYED)`. It delays scheduling without changing the Node
probe's answers, supervisor code or test assertions. Both qualified phases
record the same wrapper hash. Background files run the unmodified binary.

`*-summary.json` binds source hashes, timestamps, load counts and slow files;
`*-runs.tsv` retains every result and the active background-slot count. The
controlled failure retains the server's fatal startup diagnostic. The original
source hash is `54589e25dfa62df37e492fa8147aa3942dcf08418e1d1becbd7e1939771d7fce`;
the pre-fix source with diagnostics is
`c5073c51844aab4eab93ed8547d61804210f8dae3f44b8586a05c96e0fb2a46d`.
The committed patch reconstructs that diagnostic baseline from the pinned commit.

## Development failures and excluded batches

Two preliminary load batches are excluded from the controlled comparison and
retained in `development-load-ledger.json`. The first had one 122-second worker
failure in three runs, but one apparent pass needed manual cleanup: strace's
file-output default ignored TERM. Only the recorded, identity-checked tracer
received KILL; `--kill-on-exit` reaped its tracees. Its 795 load files passed.
The second was aborted after discovering that `trace=none` filtered the intended
injection; three target bodies passed and one background file reports
`TEST_FILE_ABORT`. A failed relative-path setup command had also left the old
wrapper in place. These are experiment/harness errors, not product failures or
qualifying passes. The final wrapper explicitly traces `clone3`, responds to
TERM, and was independently checked before either qualified phase.

An initial baseline patch command ran from the Snapback 4 subdirectory, where
Git filtered the out-of-prefix path without applying it. Source hashes establish
that the natural baseline and the two excluded batches used the original file.
The final harness applies the patch from the repository root and checks its
presence. Early nested-test development also exposed inherited
`NODE_TEST_CONTEXT`; the runner removes it so a nested test gets its own real
failure exit status. Permanent regression checks require that status. The final
staged whitespace check caught blank context/diagnostic lines in two evidence
files; their formatting was normalized and the baseline patch was re-applied to
verify the identical qualified source hash. No test input changed.

## Findings outside this fix

Three manifest-refusal fixtures wait 122 seconds apiece for a host that is
already refusing the source. Recorded separately in
[worker-refusal fixture ticket](../../../issues/20261002-snapback4-worker-refusal-tests-wait-entire-hang-guard.md).

## Round 1 — review corrections (2026-10-02)

Round-0 parent: `f9aa587e10`. Read both complete reviews: Astra **NOT READY**
(P1 descendant custody, P2 inspection errors) and Grok **READY** (three Lows).
The fixture fixes remain; no product source, original assertion, seed count or
inner hang allowance changes in this round.

### Retained custody and inspection

The external runner starts a dedicated, detached Node group keeper. The keeper
starts `node --test` inside that group and remains alive after the test launcher
exits. A successful full process-table snapshot can therefore still find the
shell's `sleep 600` after its parent has exited and init has adopted it. The
keeper reserves the group identity until the runner has signalled and verified
its members. Registered detached Node children additionally seed descendant
inspection. Cleanup repeatedly discovers group members, sends TERM, then KILL,
and checks start identities before every individual signal. A completed file
with survivors reports `TEST_FILE_LEAK` after cleanup. A stalled file keeps
`TEST_FILE_HANG` and also reaps the orphan. Failed output-pipe closure cannot
report a pass.

This is the process-group alternative in the review request on both Linux and
macOS; there is no subreaper or cgroup dependency. It does **not** contain a
native daemon that deliberately changes group/session and loses its discoverable
parent before inspection, nor descendants of an already-exited detached Node
child after such an escape. macOS has no adopted subreaper here. Direct live
Node detaches are registered; arbitrary daemon containment is not claimed.
The ordinary shell double fork in Astra's reproduction does not leave its group
and is covered on both platforms.

A failed, timed-out, empty or malformed `ps` snapshot throws
`TEST_PROCESS_INSPECTION`; Linux identity reads also propagate every error
except verified process disappearance. macOS uses the complete process table
instead of treating a nonzero `ps -p` result as an empty selection. Every ps
call sets `LC_ALL=C`, giving stable 24-character start fields and zombie parsing.
A failed inspection stays a failure even if a subsequent cleanup succeeds.
Persistent failure triggers best-effort signals to the known children and the
still-owned keeper group; this does not certify that inspection or cleanup
succeeded. TERM grace is five seconds, KILL observation two seconds, and each
ps call is limited to two seconds; inspecting many identities can add time.

Permanent checks now include both unregistered shell-orphan cases, ps exit 2,
ps timeout, malformed output, empty output, persistent inspection failure,
C-locale enforcement, and long-file/seed-override caps. The four prior runner
regressions remain. The replacement success test holds its real SQLite writer
until `onBusy` has observed BUSY/LOCKED, then releases it; it asserts positive
retry observation and retains its identity/distinct-store checks. The held-lock
and failed-probe cleanup regressions remain unchanged.

### Watchdog caps, including serial publication

The old flat 900/1,800-second caps were below the declared inner guards. Named
long files now get **900 seconds + 125% of their declared aggregate allowance**.
Search sums both host guards and the four large-overlap guards; mixed evidence
sums both hosts; session sums both tiers and the final guarded regression;
online uses its full interleaving count; admission uses its 56-scenario parent
allowance. Seed overrides feed the same calculation. For the large
horizon/acquisition/overflow/per-row files, every current case conservatively
gets the largest declared guard, including shorter or unguarded cases. These
are deliberately generous hang bounds; in particular horizon's existing
10,120-second guards produce a multi-day worst-case outer bound. Reducing those
existing inner guards is outside this fixture fix.

These exact caps apply on the loaded M5 publication MacBook with
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`; serial scheduling changes none of them.
The ordinary/fixture-wrapper cap remains 900 seconds. Named case/work counts
must be updated with changes to the corresponding declarations.

| File (`.test.mjs`) | Default outer cap, seconds |
| --- | ---: |
| ordinary files / fixture wrapper directory | 900 |
| ordinary-search-oracle | 24,060 |
| mixed-evidence-oracle | 5,400 |
| app-session-model | 26,150 |
| online-client-model | 8,400 |
| web-admission-review | 9,440 |
| column-stream-recovery | 3,600 |
| timeline-delivery | 3,600 |
| horizon-boundary | 1,038,200 |
| acquisition | 78,450 |
| sync-overflow | 63,230 |
| per-row-work | 67,150 |
| per-row-react | 19,450 |

### Verification and evidence

Final Linux focused command, from `snapback4/`:

```bash
node scripts/run-client-tests.mjs 1 files packages/snapback4/test/test-file-runner.test.mjs packages/snapback4/test/replacement-fixture.test.mjs
```

Result: **15/15 passed**, zero failed/skipped: runner **12/12**, replacement
**3/3**, on eb1000 (`expose-builder-pixel`, `100.65.137.99`), Node 24.13.1.
`round1/inputs.sha256` binds the tested runner, fixtures, stress driver and binary.

Round-1 stress command (one slot alternating the two original target tests,
23 slots cycling the full ordinary inventory; target worker only uses the
unchanged 100 ms clone3 scheduling control):

```bash
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs after /tmp/qf-r1-stress-final 200 both
```

The final run, 2026-10-02T20:20:36.447Z–2026-10-02T20:49:50.460Z, passed **worker
200/200**, **observed replacement 200/200**, and **background 1,714/1,714**.
All 283 ordinary files executed in the background. Every one of the 400 target
completions recorded 23 active background slots; the target records have one
executed worker test or two executed browser tests (the parent plus the selected
observed-replacement case), never an empty filter. After the targets finished,
all in-flight background files completed before the full suite started.
Worker min/median/max: 2913/2964.5/3042 ms;
replacement: 3481/3682.5/4086 ms.
No target or background failure occurred. This is repeated correctness under
real client-file contention, not a product latency or comparative speed claim.
Compressed metadata, every result, load timeline and TSV are in `round1/stress-*`;
`stress-stats.json` gives the checked aggregates.

Apartment mini (`100.64.36.16`), Darwin 27.0 arm64, Node 24.18.0: **15/15
passed**, zero failed/skipped, using the identical final source hashes and
`LC_ALL=de_DE.UTF-8` in the ambient test environment. The runner still sets
`LC_ALL=C` on every actual ps invocation. All 12 runner checks passed in
49.414 seconds (52.008 seconds including its outer runner); replacement checks
passed 3/3 in 4.222 seconds (5.864 including the runner). Shell-orphan pass/hang,
transient and persistent inspection failures, and start-identity inspection
therefore executed natively on the required Mac.

The fixture-only Mac checks used downloaded `snapback4-darwin-arm64@0.4.10`,
SHA-256 `b30b96dcb7e66abb4a13ba664d135c218d4d8383b2be45cbc294cbc0b90d8e44`.
This verifies portability of these runner/fixture changes, not the complete
current release or full-suite Mac timing. The initial 0.4.12 package request
returned npm ETARGET and ran no tests; that unavailable artifact is an
environmental setup failure. The successful command, inside the task-created
`/tmp/qf-r1.ojT67v` scratch directory, was:

```bash
LC_ALL=de_DE.UTF-8 SNAPBACK4_BIN=/tmp/qf-r1.ojT67v/package/snapback4 node snapback4/scripts/run-client-tests.mjs 1 files snapback4/packages/snapback4/test/test-file-runner.test.mjs snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

`round1/mini-tests.log`, `mini-tests.exit` and `mini-host.txt` retain the complete
result, platform and source/binary hashes; both npm outcomes are retained.

The **one** final `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh`
run on eb1000 started at 2026-10-02T20:49:50.704Z and finished at
2026-10-02T21:13:34.614Z, exit **0**. Its exact summary is:

```text
== 0 failure(s) in 1424 s
```

Every Rust target and doctest, build/budget/release check, package/app typecheck,
and fixture-wrapper check passed. Ordinary clients: **283/283 files, 5,800
passed, zero failed, ten unchanged conditional skips**. Models: **79/79 passed**.
Including the nine fixture-wrapper cases, the runner records **286/286 files,
5,888 passed, zero failed and ten skipped**. The complete worker file passed
61/61 in 440.643 seconds; browser admission 55/55 in 122.648 seconds; search
oracle 498.462 seconds. Model files: 240.843 and 59.936 seconds. There were no
watchdog or unexpected leak failures. **Full-suite failure classification:
ours 0, baseline 0, environmental 0.** No failed suite test was retried or omitted.

`round1/full-suite.log.gz` retains the complete log; its uncompressed SHA-256 is
`b357af054d82529703ff4975fcd25f604652e682ec440b89f1e2709c254e8ca0`. The JSON summary binds timestamps/exit/footer;
`full-suite-files.tsv` retains all counts and durations, and
`full-suite-categories.txt` retains every category verdict. All recorded inputs
matched before and after the suite. After completion, only the obsolete
model-count/30-minute comment in `scripts/test.sh` was corrected; its exact
executed source is retained in `test-sh-qualified.txt`, and the manifest binds
both that copy and the final shell file. No executable code changed after
qualification. The scoped LLP update, reference audit and shell/whitespace
checks accompany the change; product sources are unchanged.

### Development and environmental outcomes

No reviewed fixture failure is hidden by retries. Earlier Linux development
runs passed 4/4, then 11/11 runner checks and 3/3 replacement checks. The last
15/15 focused run uses the final source. Two edit-preparation commands used a
repository-relative path from `snapback4/` and failed before writing; corrected
paths succeeded. One unsupported `both` driver invocation failed before starting
any test because that preceding edit had not applied. These are our command
errors, not product failures. The first source read also named a nonexistent
registration helper; the actual preload is `test-processes.mjs`.

One preliminary 24-file run was intentionally stopped to make output-pipe
closure failure explicit before final qualification. All 25 worker targets
passed; 24 replacement targets passed and the running 25th plus all 23 active
background files reported `TEST_FILE_ABORT`. The 271 completed background
files passed. Those 24 aborts are our intervention, not flakes or qualifying
failures. Retain this batch separately from the complete final run.

The local fleet inventory and llp-orient skill paths were absent (the skill
symlinks point into an uninitialized vendor directory). The fleet inventory was
read from the permitted mini; governing LLP 3000, its adopted brief/rules,
Snapback 4 instructions, exclusions and journal supplied the manual context.
No app-authoring surface changed. The mini's SSH connection temporarily timed
out before its first remote test command started; no alternate Mac was used.
The office M1 and publication MacBook were not contacted. The mini's scratch
copy was removed at 20:40:14Z after collecting its evidence (`mini-cleanup.log`). All signals target processes
started by this task or their verified descendants. Nothing pushed or published.

Intermittent SSH and archive-retrieval failures were environmental; a persistent
connection was closed and bounded retries recovered the logs. They caused no
Mac test retry. The unavailable npm 0.4.12 package likewise ran no test.

## Round 2 — whole-group cleanup and progress watchdog (2026-10-03)

Parent: `64bde25266`. Astra's full round-1 review is **NOT READY**: a process
could fork after a real snapshot and exit before identity validation, hiding
its same-group orphan; named total-duration caps still missed social-browser
and retained-history. Both findings are addressed here. This round changes
only qualification infrastructure and its regressions/docs. The original
worker/replacement fixture fixes, assertions, test guards and seed counts remain.

Grok's completed round-1 review is **READY WITH CHANGES**. Its Medium repeats
the aggregate-cap gap (also naming keep-app-model and worker-regressions);
progress bounds resolve it for the full census. Its Low asks for exact margin
assertions for horizon and seed overrides: the permanent regression now requires
12,650,000 ms for horizon, 15,000,000 ms for 6,000 online sequences, and
7,500,000 ms for 1,000 mixed-evidence seeds. Both reviews' acknowledged native
group/session-escape limit remains explicit. Grok's mini checks were blocked;
this round retains fresh mini execution evidence instead of treating its
source/log audit as a live Mac check.

### Group cleanup and stable verification

Each file still owns a detached process group whose keeper survives node:test.
Every file, including an apparently clean successful file, now receives an
unconditional **whole-group SIGKILL** before verification. Cleanup no longer
signals only the PIDs that tree discovery happened to find. A snapshot member
that vanishes before identity validation remains leak evidence: it could have
forked a child that the snapshot missed. Registered detached Node children
retain the additional identity-checked individual cleanup path.

Verification inspects until **two consecutive snapshots**, separated by 50 ms,
contain no living group members or registered descendants. An intervening
member resets the count, triggers another group signal, and prevents a pass.
Leak evidence after a completed file reports `TEST_FILE_LEAK`; a stopped stall
retains `TEST_FILE_HANG`. Zombies are treated as dead: they cannot execute or
retain output handles. Verification retries for five seconds; each ps call has
a two-second timeout. Inspection errors remain `TEST_PROCESS_INSPECTION` and
fail closed, including errors after the first empty snapshot. Group signals
start while the keeper is alive and refuse a changed keeper PID identity;
individual signals check the recorded process start identity.

The new race regression delays a **real** process-table snapshot while an owned
shell helper forks, writes its new child's PID and exits. It proves that the
orphan was absent from the snapshot and that the sampled parents have exited
before handing that stale table back to the unchanged inspection path. The
runner must report `TEST_FILE_LEAK`, remove the orphan and leave no live group
member. A second regression interposes a stale nonempty snapshot between
empties, requiring two fresh empties after it. Both run on Linux and macOS.
The documented deliberate native group/session-escape limitation remains;
this fix covers ordinary same-group fork/reparent races, not arbitrary daemons.

### Progress watchdog and declared-guard census

The timer now measures **time since the last test lifecycle event**, initially
file startup. The execution helper uses the public `node:test.run()` API and
attaches synchronous listeners for `test:dequeue` (actual execution start) and
`test:complete` before importing tests. These events travel over IPC through
the group keeper. Each file already owns an isolated external process, so the
helper uses `isolation: none`; Node's additional child serializer and async
reporters can buffer events while synchronous test bodies keep executing.
TAP's ordered `test:start` presentation can also be delayed by nested/parallel
work. Standard TAP formatting remains separate from progress observation.
Console text, even `# Subtest:` chatter, never renews the timer. Name/skip filters
are passed to the same Node test API; unknown runner flags fail explicitly.

For largest single declared guard `G`, the stall bound is
**`max(900 s, G + max(60 s, 0.25 × G))`**, equally in serial mode. Model/search
seed overrides are included. There is **no absolute duration ceiling**: a
progressing file should not fail because it contains many sequential tests.
A true stall fails with the filename, elapsed/idle milliseconds, bound, last
subtest event, last output, owned process records and full group cleanup.

The reproducible [source census](./round2/guard-census.mjs) reads timeout and
helper-guard expressions without importing or executing test bodies. It
uses the existing TypeScript parser, evaluates source constants and current
model/search defaults, enumerates unread-range's JSON cases, and uses the
source search-limit maximum of 100. Unresolved or nonfinite guards fail the
census. [guards.tsv](./round2/guards.tsv) gives **all 286 client/fixture files**;
[guards.json](./round2/guards.json) retains the evaluated expressions. Every
maximum plus margin fits its runner stall bound. Zero means no explicit guard
in that source, not a zero timeout. Shared helper work is additionally included
where explicitly declared in that file. The runner's named long-guard table
must stay aligned with declarations; this census is the review evidence and
reproduction tool, not a new suite-wide blocking gate.

| File (`.test.mjs`) | Largest single guard, s | Stall bound, s |
| --- | ---: | ---: |
| acquisition | 1,320 | 1,650 |
| app-session-model | 10,000 | 12,500 |
| column-stream-recovery | 2,160 | 2,700 |
| horizon-boundary | 10,120 | 12,650 |
| mixed-evidence-oracle | 1,800 | 2,250 |
| online-client-model | 6,000 | 7,500 |
| ordinary-search-oracle | 8,592 | 10,740 |
| per-row-react | 2,120 | 2,650 |
| per-row-work | 2,120 | 2,650 |
| retained-history | 372 | 900 |
| social-browser | 726 | 907.5 |
| sync-overflow | 2,168 | 2,710 |
| timeline-delivery | 2,160 | 2,700 |
| web-admission-review (enclosing parent) | 6,832 | 8,540 |

Other files fit the 900-second floor including margin. Retained-history's
68 sequential 372-second guards can therefore consume their full 25,296
seconds: each start/finish resets the 900-second stall clock. Social-browser's
726 + 200 + 518 seconds likewise have no total-duration cutoff. A subtest that
uses its entire declared guard still has the explicit margin before the file
watchdog can fire. The focused sequential/nested regression runs for multiple
stall intervals; a separate test prints repeated fake progress while stalled
and must still be stopped and cleaned up.

### Verification

Linux (eb1000 / `expose-builder-pixel`, Node 24.13.1) and Apartment mini
(Darwin arm64, Node 24.18.0): **21/21 focused checks passed on each**, comprising
18 runner checks and the unchanged three replacement-fixture checks. Commands:

```bash
# From snapback4 on Linux
node scripts/run-client-tests.mjs 1 files packages/snapback4/test/test-file-runner.test.mjs packages/snapback4/test/replacement-fixture.test.mjs
# Inside the task-created mini scratch directory
LC_ALL=de_DE.UTF-8 SNAPBACK4_BIN=/tmp/qf-r2-verified.4ZqhPu/package/snapback4 node snapback4/scripts/run-client-tests.mjs 1 files snapback4/packages/snapback4/test/test-file-runner.test.mjs snapback4/packages/snapback4/test/replacement-fixture.test.mjs
# Guard census, from snapback4
node reports/20261002-qf-qualification-flakes/round2/guard-census.mjs
```

The mini exercised identical source hashes with non-C ambient locale; actual
ps calls still force C locale. Replacement checks used the published 0.4.10
Darwin binary (`b30b96dcb7e66abb4a13ba664d135c218d4d8383b2be45cbc294cbc0b90d8e44`),
so this is fixture/runner portability evidence, not current-release Mac
qualification. The scratch directory was deleted after collecting logs;
`round2/mini-cleanup.log` records removal. Only the Apartment mini was contacted.

The unscaled default-bound stall probe ran from 2026-10-02T22:09:03.511Z to
22:24:03.794Z. It deliberately blocked JavaScript after creating an unregistered
same-group shell orphan. Diagnostics fired after **900,000 ms without progress**;
the runner returned `TEST_FILE_HANG` after **900,237 ms**. The final inspection
found **zero living group members**, and the recorded orphan was dead.
`round2/stall.log` preserves the actual stalled subtest name, marker, bound and
owned process records; `stall.json` preserves the result and independent cleanup
checks. This expected failure is the requested negative control, not a suite
failure. The real probe uses no shortened timeout or seed override.
Its active runner predates only the filter-flag forwarding correction; it passes
no filters, so that correction changes none of this probe's executed semantics.
`inputs-before-filter.sha256` preserves those exact inputs.

The **final** 24-file stress ran 2026-10-02T22:15:19.097Z–22:45:06.730Z:
**worker 200/200**, **observed replacement 200/200**, and **background
1,763/1,763**, with zero failures. Every one of the 400 target completions
recorded **23 active background slots**. Every worker result executed exactly
one test; every replacement result executed exactly two (parent plus selected
scenario). All 283 ordinary files ran in the background, with no empty results.
The driver waited for every in-flight background file to finish before starting
the full suite. Command, from `snapback4/`:

```bash
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs after /tmp/qf-r2-stress-qualified 200 both
```

Worker min/median/max: **3,009 / 3,062.5 / 4,403 ms**; replacement:
**2,638 / 3,783.5 / 11,945 ms**. The worker retains the same verified 100 ms
clone3 scheduling control; background and replacement cases use the unmodified
lane binary. This is repeated correctness under real file contention, not a
product-latency or comparative-speed claim. `round2/stress-stats.json` retains
checked aggregates, and `stress-runs.jsonl.gz`, `stress-runs.tsv.gz`, metadata,
summary and load timeline preserve every result. The metadata's `sourceCommit`
is the stress harness's historical before-fixture baseline; current source and
binary custody are the SHA-256 manifests, not that historical baseline field.

The **single** full eb1000 suite ran 2026-10-02T22:45:06.774Z–23:12:41.859Z,
after every stress process finished. From `snapback4/`:

```bash
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh
```

Its exact footer is **`== 0 failure(s) in 1655 s`**, exit **0**. All build,
budget, release-guard, package/app, Rust target/doctest and fixture categories
passed. Rust enumerated 285 test binaries and 998 executions. Ordinary clients:
**283/283 files, 5,806 passed, zero failed, ten unchanged conditional skips**.
Models: **79/79**; fixture wrapper: **9/9**. Across the 286 file results,
**5,894 tests passed**, ten skipped, zero failed/cancelled/todo. The only
per-file count change from round 1 is the runner regression file, **12 → 18**;
all other counts match, including worker 61/61, admission 55/55, replacement
3/3 and retained-history 68/68. No assertion or seed count was weakened.

Full-suite failure classification: **ours 0, baseline 0, environmental 0**.
The intentional stall negative control and development outcomes below are
separate records, not full-suite failures. `round2/full-suite.log.gz` retains
the complete log (uncompressed SHA-256
`173ccd4b50e392822f76fa0bd2b8935bcb44cfd5768888bf28199e4281fdcede`);
`full-suite-summary.json`, `full-suite-files.tsv`, `full-suite-categories.txt`
and `full-suite-count-deltas.json` retain its summary and count audit.

After the suite, all **2,157 source hashes and 15 qualification inputs** still
matched. Only obsolete comments in `scripts/test.sh` then changed; its executed
source is retained as `test-sh-qualified.txt`. Qualified and final manifests,
`source-amendments.json` and `qualification-custody.json` bind both versions.
There were no post-suite executable changes. The real stall's exact runner is
also retained as `stall-runner-qualified.txt`. The Round 2 journal entry and
LLP/command-sheet updates accompany the code. Reference and whitespace checks
pass. This remains a local commit with the requested Astra trailer; nothing
was pushed or published.

### Development outcomes and scope of the final run

The initial asynchronous-reporter implementation passed the first focused set,
but a separate synchronous-work probe revealed that Node's child serializer
could buffer progress until a later event-loop turn. Ten 300 ms synchronous
subtests (each guarded at 500 ms) were wrongly killed by a 1,000 ms stall timer.
This was **our runner defect**, not a product failure. The final execution helper
observes lifecycle events synchronously in the already-isolated file process.
The permanent positive regression requires ten passes, twenty progress events
and a total duration exceeding three stall intervals. A retained old-runner
negative control reproduces `TEST_FILE_HANG`; its source variants and result
are in `round2/development-*.mjs` and `sync-progress-negative-control.*`.

The first stress batch was stopped through its own recorded PID for that fix:
worker 162 passes + one abort, replacement 162 passes + one abort, background
1,443 passes + 23 aborts. All 25 failures were intentional `TEST_FILE_ABORT`;
there were no spontaneous target/background failures. The complete records
are retained under `round2/development-stress-*` and excluded from qualification.
A second development batch exposed Node 24's in-process filter behavior:
public run options alone did not apply the name filter to the current test
tree. It was stopped before its first target completed (one worker abort,
one replacement abort, and 23 background aborts; 311 background passes).
Those records are `development-filter-stress-*`. The final helper passes
validated name/skip filters both as Node CLI flags and public API options.
The permanent filter regression failed before that correction and now proves
exactly one selected assertion-bearing case executes. That red is ours;
`development-filter-regression.log.gz` retains it. The standalone original worker
filter was then checked explicitly before restarting qualification.

One intermediate mini focused run passed 18/19: the blocked-JavaScript fixture
had no `FIXTURE_READY` marker in its captured output. Its expectation was kept;
the fixture now awaits completion of the marker write before blocking. This
is classified as **our qualification fixture failure**; the full failure and
host/source records are `mini-unflushed-*`. The subsequent pre-API mini run
passed 19/19, and the final API/filter version passes 21/21. The fork-race fixture
also gained an explicit helper-ready barrier before file completion. No original
worker/replacement assertion or seed count changed. Earlier successful focused
logs, source amendments and source manifests are retained, not represented as
final-version qualification.

Four preparation commands used a wrong working-directory prefix or named two
nonexistent optional witness files; they failed before running any test and
were corrected. A temporary custom-reporter prototype rejected an unavailable
`.on` method on its async iterator, and another stream-composition prototype
reported `AbortError` after its ten test bodies passed. These were ours and
were discarded in favor of the public run API's synchronous setup listeners.
Whitespace cleanup removed a trailing blank report line. None of these outcomes
is a product failure or a qualifying pass. No full suite was started by either
interrupted development driver; the final full suite remains a single run.

### Grok follow-up

Parent: `11c5a70745`. The completed Grok round-1 review was read in full; the
operator additionally required closing ordinary native group/session escapes.
The progress watchdog already removes the aggregate-duration cutoff for
retained-history, keep-app-model, social-browser and worker-regressions. Their
largest single guards remain 372/162/726/140 seconds, with respective stall
bounds 900/900/907.5/900 seconds. The regression now checks exact guard/bound
pairs for **all 14 derived files**, every derived file in serial mode, the two
additional floor-bound examples, and all four model/search seed overrides.
Horizon remains exactly 12,650,000 ms; dropping its margin fails the assertion.
The fresh 286-file census is in `round2/grok-followup/guards.{json,tsv}`.

Each file receives a fresh 256-bit `SNAPBACK_TEST_FILE_TOKEN` in the keeper's
initial environment, inherited by its descendants. Cleanup still kills the
whole group first. The completeness check then combines its POSIX session,
registered ancestry, and exact environment-token matches. It kills proven
owners with start-identity checks and requires two consecutive empty snapshots.
A positive token match remains evidence if the process exits while inspected;
vanishing cannot turn that snapshot into a clean result. Observed completed-file
orphans fail `TEST_FILE_LEAK`. Session custody catches even a child that clears
its environment and calls setpgid while remaining in the keeper's session.
Darwin's EPERM on a repeat signal to an already-empty group is accepted only
when another real inspection confirms that no live group member remains.

Linux reads NUL-delimited `/proc/<pid>/environ`. macOS uses a bounded Python 3
ctypes helper for KERN_PROCARGS2 and getsid; all ps/helper calls force C locale.
Only PID/session metadata, boolean matches and coded errors leave the reader;
no environment contents are logged. Other users are excluded. Exact process
identities that predate the token are excluded, as are descendants of unchanged
pre-launch processes outside the runner's ancestor chain and members of a
still-existing pre-launch session. These are causal exclusions: a file cannot
spawn an older process, be adopted by an unrelated preexisting process, or join
an existing POSIX session. Adoption by PID 1 or an ancestral subreaper does not
establish unrelatedness. Unknown ownership never authorizes a signal.

The remaining detection escape requires removing/replacing the inherited token,
starting a new session, and losing registered/discoverable ancestry before
inspection. **Inspection failure is a separate limit:** Darwin 27 redacts the
environment of restricted system executables. A task-owned `/bin/sleep 600`
probe confirmed both KERN_PROCARGS2 and `ps -E` return success without exposing
its token. This matches Apple's [kernel implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sysctl.c),
which can omit environment data for restricted executables. An opaque candidate
outside the known session therefore produces `TEST_PROCESS_INSPECTION`; the
runner cannot safely identify it for killing. This is a refused file, never a
passing cleanup. `native-visibility.json` preserves the probe without its env.
No claim here says the runner automatically reaps that opaque process.

The three visible-token escape regressions use a small, task-compiled native
sleep fixture, so both hosts exercise actual setsid/setpgid and a Node helper
that spawns detached and exits, with stdio closed. A fourth fixture clears the
token before setpgid and proves the session check still reaps it. The native
platform-binary integration case uses real `/bin/sleep`: Linux must reap it and
report `TEST_FILE_LEAK`; if Darwin redacts it, the runner must refuse and the
regression itself reaps its own recorded child. Separate checks preserve token
isolation between files and fail-closed environment inspection.

Final Linux focused checks are **29/29, exit 0** (26 runner cases plus the
unchanged three replacement cases). The mini's session-custody version passed
29/29 before two metadata-validation checks were tightened. On the final source,
its combined run passed all 29 assertions but refused the outer runner file
for two opaque candidates (PIDs 41310 and 41341); the replacement file passed.
Those candidates had exited before the later metadata-only probe, so their
provenance is unknown. A diagnostic observer rerun of the final 26 runner cases
passed **26/26, exit 0**, preserving the same inspection implementation while
recording helper metadata. It caught a newly started, environment-redacted
`mdworker_shared` in the unchanged pre-launch session 1 and correctly excluded
it. This is evidence for the session exclusion, not permission to ignore an
unknown candidate. `mini-observer.{mjs,json,log}` retains that investigation;
`mini-combined.log.gz` retains the refused combined run, not relabeled green.

Mini commands use `LC_ALL=de_DE.UTF-8`; the C-locale process checks and all escape
shapes run there. Final mini source hashes match. Its published 0.4.10 binary
provides replacement-fixture portability only, as in the initial Round 2 run.
The actual Linux and mini logs, host hashes and scratch-removal receipt are
under `round2/grok-followup/`. Nothing ran on the office M1 or publication MacBook.

The follow-up's full suite is a separate, single invocation of
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh` on eb1000.
The session/metadata corrections were made during its Rust phase, **before any
client or fixture runner executed**; no Rust/product source changed. Retained
suite prefixes, both source versions and `source-amendments.json` bind that
transition. This does not relabel the earlier Round 2 suite or 200-repetition
stress as a run of the new token implementation.

The full run was 2026-10-02T23:39:00.292Z–2026-10-03T00:07:42.469Z.
Its exact footer is **`== 1 failure(s) in 1722 s`**, exit **1**: the failed
category is `client tests`. All Rust targets/doctests, builds, budgets, release
guard, package/app checks and fixture wrappers passed. Ordinary clients passed
**5,814 assertions**, with zero assertion failures and ten unchanged skips;
models passed **79/79**, fixture wrappers **9/9**. Across 286 file results,
**5,902 assertions passed, zero failed/cancelled/todo, ten skipped**. Counts
match the initial Round 2 run except the runner file's eight added cases
(18 → 26). The suite is **not fully qualified**: 13 ordinary files failed the
new environment completeness check after passing their assertions.

Every failed file below is classified as an **introduced inspection refusal:
EACCES reading a new candidate's environment**. These are not established
baseline product failures, and no ownership is inferred from denied access.
All 14 denied candidate PIDs were absent at the later metadata-only probe;
their provenance remains unknown. The runner did not ignore these errors or
signal a process based only on an unreadable environment.

| File (`.test.mjs`) | Assertions passed | Denied candidate PID(s) |
| --- | ---: | --- |
| delivery-clients | 14 | 50800 |
| following-routing | 4 | 133250 |
| app | 78 | 140387 |
| asset-avatars | 14 | 146988 |
| online-store-terminal | 16 | 160943 |
| one-shot-review | 72 | 158783 |
| page-authority | 13 | 168999 |
| publication-roundtrip | 14 | 173365 |
| schema-capabilities | 1 (four skipped) | 183040 |
| residency | 10 | 182297, 184104 |
| server-runtime | 47 | 185081 |
| subscription-pressure-e2e | 2 | 193845 |
| readauth | 10 | 198131 |

`full-suite.log.gz` retains the complete run. `full-suite-summary.json`,
`full-suite-files.tsv`, `full-suite-count-deltas.json`, and
`full-suite-failure-classification.{json,tsv}` bind its result and every refusal;
`refused-candidates-later-probe.json` records the later absence check.
All **2,160 final source hashes and 18 qualification input digests** match after
the suite. No executable input changed after the client phase began. The
[open inspection-refusal ticket](../../../issues/closed/20261003-snapback4-token-inspection-refusals-on-shared-hosts.md)
records the remaining work without weakening fail-closed behavior or claiming
cleanup of opaque processes. The requested local commit includes the report,
LLP/command-sheet updates and append-only journal entry; nothing is pushed or
published.

Development outcomes are retained separately. The first Linux run passed 25/26
assertions but refused an unreadable new candidate; causal process/session
exclusions narrowed the candidate selection. The first mini run
passed 24/27: all three new escape cases found their token-owned orphan, then
failed on Darwin's repeat-group EPERM; that was our cleanup defect. The next
two mini runs passed 26/27 and 27/28, with refusals on newly observed opaque
candidates; the no-progress assertions themselves passed. Those candidates
were gone by a later metadata-only check, so their provenance is not asserted.
Session identity now supplies an additional proof of unrelatedness without
ignoring inspection failures. All focused assertions pass with their full
expectations retained; the final combined mini wrapper refusal is recorded
above. Preparation mistakes (a redundant directory prefix, a
nonexistent optional tar path, a wrong npm package scope, and the remote shell's
reserved `status` name) were ours and ran no failing product test.

## Round 3 — shared-host token inspection (2026-10-03)

Parent: `062fbc75ed`, above Round 2 at `11c5a70745`. This implements the
operator's ruling for eb1000 and the Apartment mini, both shared hosts. The
Grok follow-up's 13 file refusals remain historical introduced failures; they
are not reclassified as baseline failures or erased by this round.

### Policy and implementation

An unreadable candidate environment is **not provably ours**. EACCES, EPERM and
Darwin kernel redaction produce one `TEST_PROCESS_UNREADABLE` diagnostic per
process identity per file, naming PID, executable and start time. Repeated
cleanup snapshots do not repeat the same identity's diagnostic. The candidate
is neither signalled nor a reason to refuse the file. Linux prefers the exe
link, falls back to readable argv[0], then ps's executable name; diagnostics
contain no environment values or remaining arguments. Darwin uses ps's
executable metadata. The Linux development check caught `comm=MainThread` for
Node; the executable lookup corrects that diagnostic without changing custody.

**Inspection-mechanism failures remain fail-closed:** process enumeration and
identity failures, ps/helper exit or timeout, empty or malformed process-table
output, malformed/incomplete/invalid helper JSON, malformed KERN_PROCARGS2
results and other reader failures still produce `TEST_PROCESS_INSPECTION`.
A candidate which exits during Darwin inspection is represented separately as
ESRCH, with its recorded identity checked before accepting that disappearance.
Readable environments carrying this file's token remain positive ownership:
cleanup kills those survivors and fails the file as `TEST_FILE_LEAK`.

Whole-group cleanup, retained session custody, start-identity checks, two
consecutive empty verification snapshots, the subtest-progress watchdog, every
exact-bound assertion and all readable-environment escape regressions remain.
No worker/replacement assertion, case count, model seed or product source was
changed. Six additional Darwin helper-mechanism regressions cover exit,
timeout, malformed JSON, incomplete output, invalid rows and malformed kernel
results. A cross-platform permission-denial regression proves a healthy file
passes, its opaque candidate stays alive, and repeated inspections emit exactly
one diagnostic with the expected identity. The real Darwin `/bin/sleep`
regression requires a passing file, no inspection refusal, one diagnostic and
an untouched child; the fixture then reaps its own recorded child and verifies
it is dead. Readable native token escapes still require automatic cleanup and
`TEST_FILE_LEAK` on both platforms.

**Residual limitation:** an escaped process (new session or group, lost
ancestry) whose environment is unreadable or redacted, or which removed its
token, is not detected once outside group/session custody. On macOS this
includes restricted system executables such as `/bin/sleep`. A group change
alone within the owned session remains covered, including a cleared-token
child. Passing cleanup means no observed owned survivors, not proof that no
opaque escaped process exists.

The read-only `llp-orient` context is scoped to the runner and fixtures:
LLP 3000#publication-suite-under-contention governs ownership, preserved
assertions and progress; LLP 3000#publication-suite-on-small-hosts governs the
shared file pool. The operator's newer ruling supersedes the former
candidate-read-denial refusal. LLP 3000 and the testing notes in AGENTS.md now
state that distinction and the residual limitation. No new LLP or authoring
surface is introduced; the existing @ref targets still apply. Hand-off: none.

### Verification and interruption

Final focused Linux checks: **30 passed, zero failed/refused, six Darwin-only
mechanism checks skipped**, 36 declared tests. Apartment mini: **36/36 passed,
zero failed/refused/skipped**, under `LC_ALL=de_DE.UTF-8`, with matching source
hashes. The mini exercised all mechanism refusals inside the regressions and
both real redacted `/bin/sleep` shapes. Its outer runner also diagnosed eight
opaque shared-host candidates without refusing the file. The fixture-only Mac
checks used the same published 0.4.10 binary as previous rounds (SHA-256
`b30b96dcb7e66abb4a13ba664d135c218d4d8383b2be45cbc294cbc0b90d8e44`), not a
current-release Mac qualification. The recorded task scratch directory was
removed after collecting `mini-tests.log`, exit status and source hashes;
`mini-cleanup.log` is the receipt. No other Mac was contacted.

The operator interrupted the first stress attempt to free eb1000's CPU and
disk for publication qualification, stopped this session's processes and
deleted this lane's target directory. No full suite had started. The retained
partial batch has 282 results: 16 worker and 15 replacement target results,
and 251 background results. Its 23 failed results are `TEST_FILE_ABORT` during
the operator stop; the interrupted ps received SIGTERM and correctly failed
inspection. This batch is excluded from qualification. Source verification on
resume matched all 2,160 pre-pause hashes. The target was rebuilt cold; build
and qualification binary hashes are recorded separately. The complete suite
then precedes the restarted stress batch so all rebuilt artifacts are ready.

Main's `2dfeb99875` independently landed the fixture fixes and `1bea1a149c`
substituted a local nested-test helper because main lacked this runner. The
comparison in `main-fixture-diff.patch.gz` confirms the only replacement-fixture
difference is that helper and its imports. This lane retains the runner import
and identical fixture assertions. At landing, resolve that file to this lane's
version alongside the runner; do not retain both helpers. Main was not merged.

Commands (Linux from `snapback4/`; complete logs and source custody in `round3/`):

```bash
node scripts/run-client-tests.mjs 1 files packages/snapback4/test/test-file-runner.test.mjs packages/snapback4/test/replacement-fixture.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs after /tmp/qf-r3-stress-final 200 both
# Apartment mini, within /tmp/qf-r3.NhsBsH before removal:
LC_ALL=de_DE.UTF-8 SNAPBACK4_BIN=/tmp/qf-r3.NhsBsH/package/snapback4 node snapback4/scripts/run-client-tests.mjs 1 files snapback4/packages/snapback4/test/test-file-runner.test.mjs snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

The development Linux focused run failed one new diagnostic assertion because
ps returned `MainThread` instead of Node's executable. This was our diagnostic
bug, fixed before final focused checks; its log is retained. A resumed driver
preparation command referenced a removed `/tmp` helper and failed before any
suite or stress invocation; it was rewritten locally. These are not qualifying
passes or baseline product failures. Interrupted failures are separately
classified above. The complete suite and final stress results follow below.

### Complete suite

The one full suite ran on eb1000 from **2026-10-03T02:52:11.006Z to
03:18:44.117Z**, exit **0**, with the exact footer:

```text
== 0 failure(s) in 1593 s
```

All Rust targets (285 binaries, 998 executions), doctests, builds, budgets,
release guard, app/package checks and fixture wrappers passed. Ordinary clients:
**5,815 passed, zero failed, 16 skipped**; models **79/79**; fixture wrappers
**9/9**. Across 286 file results, **5,903 passed, zero failed/cancelled/todo,
16 skipped**. Compared with the Grok follow-up, only the runner's new cases
change the counts: one additional Linux pass and six Darwin-only skips. The
ten preexisting conditional skips are unchanged. Full-suite failures by
classification: **ours 0, baseline 0, environmental 0; inspection refusals 0**.
There are no failed files or categories to classify.

**18 distinct unreadable host candidates were skipped**, each with one retained
diagnostic line; all reported EACCES. The permission-denial regression adds
one separately labelled, deliberately injected candidate (19 diagnostic lines
total including that control). All 18 actual lines, naming PID, executable
metadata and start time, are in
[`round3/full-suite-unreadable.log`](./round3/full-suite-unreadable.log), with
machine-readable rows in `full-suite-unreadable.json`. The injected control is
in `full-suite-controlled-unreadable.log`. Examples copied verbatim:

```text
TEST_PROCESS_UNREADABLE: {"pid":3905193,"executable":"chrome","start":"Sat Oct  3 05:03:55 2026","reason":"EACCES"}; not provably ours; skipped
TEST_PROCESS_UNREADABLE: {"pid":3909545,"executable":"snapback4","start":"Sat Oct  3 05:04:01 2026","reason":"EACCES"}; not provably ours; skipped
```

Executable paths/argv[0] were unavailable for these transient candidates at
diagnostic time, so these rows retain ps's command name. Four rows say
`MainThread`; that fallback is not a claim identifying their executable path
or ownership. No candidate's provenance is inferred from its name or denial.
Start fields retain the host's local C-locale ps representation. The complete
compressed log, exact result, per-file counts, category outcomes and count
deltas are retained as `full-suite*` artifacts.

The cold standalone Cargo build produced a different executable hash; the
suite's Cargo test phase reproduced the original qualified binary exactly:
`41f1af67d2190465b68144df0524f9cc1ece7e086b75ff6fefefd77bdb574933`.
`binary-rebuild.json` and the before/after input manifests record this normal
build transition. No product or test source changed during qualification. The
post-pause Linux focused check also passed 30 tests with six Darwin-only skips;
its earlier pre-pause pass is retained separately.

### Final stress and failure classification

The restarted batch ran **2026-10-03T03:18:44.155Z–03:52:42.102Z**, after the
full suite and with no source changes. Worker **200/200 passed**; observed
replacement **200/200 passed**. Each worker target executed its one selected
test; each replacement target executed two tests (the parent and selected
observed-replacement case), with no empty filter. All 400 target completions
recorded **23 active background files**. The controlled 100 ms clone3 delay
wrapper remained on the worker target, as in the earlier rounds.

| Target | Runs | File / assertion failures | Minimum / median / maximum |
| --- | ---: | --- | --- |
| Worker admission retry | 200 | 0 / 0 | 3,180 / 3,380.5 / 6,390 ms |
| Observed replacement | 200 | 0 / 0 | 3,740 / 4,086 / 7,128 ms |

The background completed **1,953 executions across all 283 ordinary files**,
with **zero assertion failures and two file refusals**. All in-flight files
finished normally before collection. The stress driver exits **1**, because
it correctly includes background refusals in its status; this is not a wholly
green stress batch, despite all requested target repetitions passing.

| Execution | File | First failure | Test outcome | Classification |
| --- | --- | --- | --- | --- |
| `load-207` | `schema-capabilities.test.mjs` | malformed `/proc/4185250/stat` | 1 passed, 4 platform skips | Inspection-mechanism refusal; cause unknown |
| `load-753` | `remembered-answers.test.mjs` | malformed `/proc/268164/stat` | 21 passed | Inspection-mechanism refusal; cause unknown |

These are **not candidate-environment refusals**. The numeric stat parser and
its fail-closed rule were unchanged in Round 3; the operator explicitly requires
unparsable inspection output to refuse the file. The raw rejected snapshots
were not captured, so no kernel-race, ownership, baseline-product or new-policy
attribution is justified. Their subsequent `keeper exited before cleanup`
messages are secondary to the initial failure after whole-group kill. The
[separate proc-stat follow-up](../../../issues/20261003-snapback4-malformed-proc-stat-during-stress.md)
requests the missing diagnostic evidence without weakening the guard.
The resolved [token-permission ticket](../../../issues/closed/20261003-snapback4-token-inspection-refusals-on-shared-hosts.md)
records the narrower permission-policy fix and the accepted escape limitation.

`stress-stats.json`, `stress-{metadata,summary,runs,load}.*`, the driver result,
`stress-failure-classification.json` and both `stress-load-*.log.gz` files retain
every outcome. No failed attempt or background refusal is removed from the
record. This is repetition evidence under shared-host file contention, not a
controlled performance comparison or a claim that opaque escaped processes
are detected.

All 2,160 source hashes and all 18 final qualification input hashes match.
The final reference/whitespace checks and journal-prefix check are recorded in
`final-integrity.json`. The journal entry is appended, not rewritten. The local
commit carries the requested Astra co-author trailer. Nothing is pushed or
published, and main is not merged.

The staged evidence check found whitespace in the development failure log and
in a patch context line that the earlier unstaged check did not include. Both
artifacts are retained byte-for-byte as gzip files; the local commit was
amended after a complete staged whitespace check. No executable source changed
and no verification result was discarded.
