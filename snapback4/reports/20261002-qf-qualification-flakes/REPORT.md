# QF — qualification flakes

Status: Round 8 complete on eb1000: full suite and all three client phases with the ps shim pass; final focused checks 64/64 plain and 64/64 with live malformed metadata. macOS checks are pending operator verification by amendment. No push or publication.

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
[separate proc-stat follow-up](../../../issues/closed/20261003-snapback4-malformed-proc-stat-during-stress.md)
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

## Round 4 — vanished-process inspection (2026-10-03)

The operator ruled that disappearance between process enumeration and a
per-process read is normal. This round starts at `3d803c79c0`, on
`sb4-intent/qf-qualification-flakes`, and addresses both Round 3 background
refusals (`load-207` and `load-753`). Those old snapshots were never retained;
their exact kernel contents and cause cannot be recovered retrospectively.

### Scope and implementation

The read-only `llp-orient` context remains the process runner and its fixtures.
LLP 3000 (in `llp/current/`) §publication-suite-under-contention governs process
custody, two empty snapshots, first-error diagnostics and progress bounds;
§publication-suite-on-small-hosts and the operator limit Mac execution to the
Apartment mini. LLP 2000.000 and the adopted rules supply the fence. No authoring
surface changed. The documentation update is the new operator ruling in LLP
3000, the command-sheet summary, this report, the issue resolution and journal.
Hand-off: none. The Round 3 opaque-escape limitation remains unchanged.

`identity()` now reads stat as bytes, parses after the last `)`, and validates
the PID prefix, state and complete numeric tail before using parent/group/session
and start time. Its error path rechecks existence with `kill(pid, 0)` for every
read/parse failure, including ENOENT/ESRCH, empty and truncated contents. ESRCH
means exited; EPERM proves presence. If still present, the refusal includes
`firstError` and lossless `rawBase64` metadata. An existence-check error retains
the first error too. No environment bytes are included in a diagnostic.

The ps reader keeps the executable as the final field, with spaces and
parentheses intact. Its rejected rows retain their original bytes. A malformed
row with a recoverable PID is ignored only if that PID has vanished; missing
PID framing, a failed command, timeout or empty process table still refuses.
The same stat reader supplies parent/start-time checks. Linux environment read
errors and Darwin per-PID kernel/session errors recheck existence too. A present
unreadable candidate keeps Round 3's diagnose-and-skip policy; other present
errors refuse. Whole-helper failures and malformed helper framing remain
mechanism failures. A stale group member or token match that has exited is omitted from live leak
results. The two prior stale-snapshot regressions now require this ruling:
a vanished parent does not refuse its file, while unconditional group cleanup
still kills its unsampled child; stale exited rows do not reset the empty-scan
count. Previously observed live leaks still fail. A new end-to-end fixture
requires a healthy file to pass after its transient group child exits between
the stored enumeration and the runner's identity read.

`runFile()` now keeps the **first** inspection failure in its returned result.
Secondary cleanup failures are still printed, but cannot replace the rejected
snapshot with `file group keeper exited before cleanup` or another later error.

### Deterministic regressions and host evidence

Twelve added cases cover a real child exiting after its ps snapshot but before
identity inspection; empty, truncated and unparsable stat for that gone PID;
ENOENT/ESRCH/EIO reads; stat comm containing `) (` and spaces; ps command names
with the same characters; invalid parent/start metadata; present empty or
missing stat; and paired gone/present environment error classifications.
The present malformed stat and ps cases run through `runFile`, require refusal,
recover the exact byte sequence (including invalid UTF-8, NUL and CR), and
require that a subsequent cleanup error does not overwrite the first error.

Linux (eb1000, Node 24.13.1): **42 passed, six Darwin-only skips**, 48 declared,
**zero outer file refusals**. Apartment mini (Darwin 27.0 arm64, Node 24.18.0):
**48/48 passed, zero skips, zero outer file refusals**. Both totals include the
three unchanged replacement fixture cases. Commands:

```sh
# Linux, repository root
node snapback4/scripts/run-client-tests.mjs 1 files snapback4/packages/snapback4/test/test-file-runner.test.mjs snapback4/packages/snapback4/test/replacement-fixture.test.mjs
# Apartment mini, task-created /tmp/qf-r4-final.ZVwcD3
LC_ALL=de_DE.UTF-8 SNAPBACK4_BIN=/tmp/qf-r4-final.ZVwcD3/package/snapback4 node snapback4/scripts/run-client-tests.mjs 1 files snapback4/packages/snapback4/test/test-file-runner.test.mjs snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

The mini uses the published 0.4.10 binary only for the unchanged replacement
fixture; this is runner portability evidence, not current-release Mac product
qualification. `round4/mini-inputs.sha256` binds its actual source and binary.
The first setup command mistakenly named `@expo/snapback4-darwin-arm64` and
received npm 404 before any test started. `mini-setup-error.log` retains it;
the corrected unscoped package download is in `mini-pack.log`. This is an
operator-command preparation error, not a test or product failure. The final
focused logs and statuses are retained. Only the Apartment mini was contacted;
its scratch cleanup receipt is `round4/mini-cleanup.log`. No unrelated process
received a terminating signal.

The initial development focused run passed 41 plus six skips on Linux and
47/47 on the mini. Review then found the old vanished-group leak evidence
rule contradicted this round's operator ruling. The final change above and
new end-to-end fixture prompted fresh focused runs on both hosts; the earlier
results are retained as `development-*`, not used as final-source evidence.
The correction occurred during the full suite's Rust phase, before ordinary
clients started (`source-finalized.json`). Its nine fixture-wrapper assertions
had already run, so those wrappers also run separately against the final source
in `final-fixtures.log`; no Rust or product source changed. `scripts/test.sh`
is invoked only once in this round.

### Single eb1000 full suite

The sole full-suite invocation ran **2026-10-03T04:08:31.799Z–04:33:41.919Z**,
exit **0**, from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT scripts/test.sh
```

Its exact summary line is:

```text
== 0 failure(s) in 1510 s
```

All Rust, build, wasm, release-guard, package, app and fixture categories pass.
Ordinary clients: **283/283 files, 5,827 passed, 16 skipped, zero failed**.
Models: **79/79**. Fixture wrappers: **9/9**, also independently **9/9** on
final runner source after the stale-member correction. Relative to Round 3,
the only assertion-count delta is the runner regression file: 33 → 45 declared,
27 → 39 passed, six Darwin-only skips unchanged. The ten other skips are
unchanged. Total JavaScript results: 5,915 passed, 16 skipped, zero failed.

Failure classification: **introduced failures 0; baseline failures 0;
environment failures 0; inspection refusals 0**. Fourteen distinct unreadable
host candidates were diagnosed without refusal, plus one controlled regression
candidate. No unknown ownership authorized a signal. Deliberately injected
failure cases are passing negative tests, not full-suite failures.

`round4/full-suite-summary.json`, `full-suite-files.tsv`, category/diagnostic
records and the complete compressed log retain the counts and evidence;
`full-suite-count-deltas.json` compares every file against Round 3. The log's
SHA-256 is `6181560c5dd093eab007c45de60ad3609af9941e6027789dd93a176efbd12793`.

### Final 24-file stress and disposition

The unchanged stress harness ran **2026-10-03T04:33:41.959Z–05:08:53.726Z**,
exit **0**, after the suite and all other Linux checks finished. From `snapback4/`:

```sh
SNAPBACK4_QF_WORKER_BIN="$PWD/reports/20261002-qf-qualification-flakes/delayed-server.sh" node reports/20261002-qf-qualification-flakes/stress.mjs after /tmp/qf-r4-stress-final 200 both
```

| Work | Executions passed | Assertion failures | File refusals |
| --- | ---: | ---: | ---: |
| Original worker admission regression, delayed server startup | **200/200** | **0** | **0** |
| Original observed-replacement regression | **200/200** | **0** | **0** |
| Background, cycling all 283 ordinary client files | **2,031/2,031** | **0** | **0** |

Every target completion records **23 active background files**, making the
requested 24-file load. Each worker repetition executes its one selected
assertion; each replacement repetition executes its two assertion-bearing
cases. All background executions finish normally, including the long final
drain; none is aborted or represented by an empty result. This round's
`load-207` (schema-capabilities) and `load-753` (remembered-answers) both pass
without inspection errors. Their Round 3 refusals remain historical evidence;
without the lost snapshots, this round does not claim their precise cause.

`round4/stress-stats.json` checks the counts, selected assertions and active
background slots. The compressed metadata, summary, complete JSONL/TSV run
records and load timeline retain every execution. The failure-classification
record is empty. The harness metadata's `sourceCommit` is its historical
before-fixture pin, not the source used for this run; the final input hashes
and this commit bind the actual runner and fixtures.

The [proc-stat ticket](../../../issues/closed/20261003-snapback4-malformed-proc-stat-during-stress.md)
is **resolved**: normal disappearance no longer refuses, present malformed
metadata remains fail-closed with recoverable bytes and first-error custody,
and both hosts plus the requested full suite and stress are qualified. The
unknown contents of the two old snapshots are a historical limit, not an
unimplemented part of this ruling. The opaque escaped-process limitation from
Round 3 remains explicit in LLP 3000 and the command sheet.

`inputs-before.sha256` and `source-before.json` retain the initial run inputs;
`source-finalized.json` and `inputs-final-source.sha256` bind the correction
before ordinary clients began. `inputs.sha256`, `source-final.json` and
`final-integrity.json` verify the final state. All 18 runner/fixture/binary
inputs remained unchanged after that correction. Only the documented runner,
regression and documentation edits differ from the initial source manifest;
no Rust or product source changed. Reference and whitespace checks pass.
This is a local commit with the requested Astra co-author trailer; nothing
is pushed or published.

## Round 5 — merge with main (2026-10-03)

This round merges fetched `origin/main` **1b879881bee0079c357356685f1a671fe0aed13b**
into lane parent **4291d06dee**, with a real two-parent merge and no rebase.
The common base is `850fea9957`. Qualification is bound to this fetched main
snapshot; later main movement is outside this result. Nothing is pushed or
published. The lane's independent final dual review runs elsewhere and is not
claimed as part of these checks.

### Orientation and conflict resolutions

The read-only `llp-orient` scope is the process runner, test scheduling,
replacement fixtures and merge documentation. Governing documents remain
LLP 3000 (in `llp/current/`) §publication-suite-under-contention and
§publication-suite-on-small-hosts, with LLP 2000.000 and the adopted rules.
The source `@ref`s resolve to those sections. The guard formula, process
custody, first-error retention and opaque-candidate limitations are unchanged.
No authoring surface changes; no new design decision or LLP is needed.
Hand-off: none. Documentation updates are this report, the closed ticket's
integration note and the append-only JOURNAL entry.

Git reported exactly three conflicts (`round5/merge-conflicts.json` and the
compressed original conflict diff):

| Conflict | Resolution |
| --- | --- |
| `packages/snapback4/test/replacement-fixture.test.mjs` (add/add) | Import `runFile` from `scripts/run-client-tests.mjs`; remove main's temporary local helper and its two imports. Every assertion and the rest of the fixture match main. |
| `issues/closed/20261002-snapback4-browser-replacement-fixture-lock-cleanup.md` | Keep main's closed ticket and independent-publication history; append the QF runner integration and qualification link. No duplicate open ticket. |
| `JOURNAL.md` | Preserve main's complete journal as a prefix and append QF's conflicting suffix intact, then append this round's entry. Relative to the lane parent, all changes are additions. |

Main's separately landed replacement-server, worker startup-race and devServer
PID fixes are byte-identical to the merged files. All Rust source matches main.
The other lanes' changes merge without textual conflicts; none is replaced
with an older lane snapshot. `merge-integrity.json` retains these comparisons.

The post-merge source census found one **semantic merge integration gap**:
main's `live-margin-browser.test.mjs` declares `hangBudget(800)` (1,720,000 ms),
while its new filename received the runner's 900,000 ms default stall bound.
The runner now names that existing work count and derives **2,150,000 ms**
using the unchanged 25% margin. Its bound regression covers normal and serial
mode. No test timeout, assertion, sample or seed changes. The final census
covers **303 files with zero undercovered guards**, compared with 286 in
Round 4. The original failed census is retained; it was not a full-suite
failure or a baseline defect.

That correction was finalized at **2026-10-03T05:21:07.369495Z**, during the
suite's Rust phase and before the client phase existed. `guard-finalized.json`
records this boundary, and source manifests retain both versions. The completed
fixture wrapper phase uses the same bounds and semantics before and after the
one-filename correction. Both hosts' focused checks are repeated on final
source. A census setup attempt used a repository-root-relative path from
`snapback4/`; it failed before executing the census and is retained separately
as a preparation error.

### Host checks and baseline control

Only eb1000 (`expose-builder-pixel`) and the Apartment mini (`100.64.36.16`)
are used. No office M1 or publication M5 is contacted. No unrelated process
is signalled. Linux uses Node 24.13.1; the mini uses Node 24.18.0 and the same
published `snapback4-darwin-arm64@0.4.10` binary as Round 4 for replacement
fixture portability. This is not current-release macOS product qualification.

The two focused files are `test-file-runner.test.mjs` and
`replacement-fixture.test.mjs`, run through the shared runner with one file
slot. The pre-correction results are Linux **42 passed / six Darwin-only
skips** and mini **48/48 passed**; they are retained as `before-guard-*` and
are not substituted for final-source results.

A separate detached worktree at **1b879881be**, clean before and after the
check, runs main alone without QF's runner:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 \
  cargo test -p snapback4-lang -p snapback4-sim \
  --test prefix_reads --test membership_search --no-fail-fast
```

It exits **101**, with **30 passed and four failed** across the two targets:

- `snapback4-lang::prefix_reads::explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`
- `snapback4-lang::prefix_reads::prefix_reads_compile_without_notes_and_caps_follow_one_schema_number`
- `snapback4-sim::membership_search::edges::calendar_repair_executes_the_same_offset_boundary_predicate`
- `snapback4-sim::membership_search::refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches`

Each reproduces the documented `N_SHAPE_METER` / empty-notes assertion failure.
These are **baseline**, tracked by the existing
[UB ticket](../../../issues/20261003-snapback4-shape-meter-note-breaks-prefix-and-membership-search-tests.md).
`main-rust-baseline.log.gz`, its result and `main-baseline-source.json` retain the
independent reproduction. The macOS replay startup-banner and publication
`decorationExpiry` regressions are not exercised by the mini's runner-only
checks; no fresh reproduction or fix is claimed for them.

Final-source focused results: **Linux 42 passed, six Darwin-only skips; mini
48/48 passed**, zero assertion failures and zero outer file refusals on both.
All 13 mini source hashes match the merged tree. The task-created mini scratch
is removed after evidence collection (`mini-cleanup.log`); its binary hash and
host metadata remain in the report directory. Commands, from the repository
root (on the mini, from its task-created scratch):

```sh
node snapback4/scripts/run-client-tests.mjs 1 files \
  snapback4/packages/snapback4/test/test-file-runner.test.mjs \
  snapback4/packages/snapback4/test/replacement-fixture.test.mjs
# mini: same command with these environment values
LC_ALL=de_DE.UTF-8 SNAPBACK4_BIN="$PWD/package/snapback4" node \
  snapback4/scripts/run-client-tests.mjs 1 files \
  snapback4/packages/snapback4/test/test-file-runner.test.mjs \
  snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

### Single eb1000 full suite and final disposition

The sole `scripts/test.sh` invocation ran **2026-10-03T05:16:55.457706Z–
05:42:55.380372Z**, exit **1**, with this command from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Its exact summary line is:

```text
== 1 failure(s) in 1560 s
```

The one failed category is **cargo test**, containing exactly the four UB
baseline failures listed above. All four also fail on the clean main-only
control. There are **zero QF failures, zero remaining merge failures, zero
environmental suite failures, and zero runner inspection/cleanup/stall
refusals**. The runner causes no new failure or refusal. The pre-qualification
live-margin bound correction is recorded separately as integration work, not
hidden in the baseline classification. No full-suite retry was run.

| Suite scope | Outcome |
| --- | --- |
| Rust | 287 test binaries, 1,000 executions; only `snapback4-lang::prefix_reads` and `snapback4-sim::membership_search` fail, two assertions each. Workspace doctests pass. Linux `snapback4::replay` passes 22/22. |
| Build, wasm, budgets, release guard, package/app checks | All pass. Wasm is 617,410 B gzip against the unchanged 618,040 B budget. |
| Ordinary clients | **300/300 files**, **6,036 passed**, **17 skipped**, zero failed/cancelled. |
| Serial models | **79/79 passed** (52 app-session, 27 online-client). |
| Fixture wrappers | **9/9 passed**. |
| All JavaScript | **303 file results**, **6,124 passed**, **17 skipped**, zero failed/cancelled/todo. |

The prior 16 skips remain; main adds the platform-conditional native export
adapter skip. Every skip and every per-file count is retained, with the
Round-4 count delta. The suite emits **21 distinct actual unreadable-candidate
diagnostics**, all EACCES, handled by the unchanged diagnose-and-skip rule.
No opaque-candidate diagnostic becomes a file refusal or permission to signal.
The known opaque escaped-process limitation remains; no stronger containment
claim is made.

`round5/full-suite.log.gz`, its result, summary, per-file TSV, categories,
skips, diagnostics and `full-suite-failure-classification.json` retain the
complete outcome. The baseline log is `main-rust-baseline.log.gz`. Source
manifests bind **2,436 tracked inputs**, with the only qualification amendments
being the runner's one added bound and its regression assertion. The manifests,
initial/qualified tree IDs and merged binary hash bind the tested code; the
subsequent JOURNAL append is documentation only.

The reference audit passes with zero errors. The staged QF diff against the
merged main parent passes whitespace checks. A whole merge diff against the
lane parent reports inherited whitespace in **43 historical evidence files**;
every offending file is byte-identical to main (`inherited-whitespace.json`
and its compressed original output). They are retained unchanged. All issue
states are consistent with main: replacement-lock, token-inspection and
proc-stat tickets closed; the separate worker-refusal timing ticket open.

The local merge commit lists all three conflicts and their resolutions and
carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Neither the branch
nor any package is pushed or published.


## Round 6 — simplification

Operator commission: read both final reviews in full, remove ancestry/token
ownership, retain the file group's cleanup and watchdog, and restore Node's
pass/fail semantics. Starting commit is Round 5's merge **808d173ee2** on
`sb4-intent/qf-qualification-flakes`. Astra's verdict is **NOT READY** with
three P1s and one P2; Grok's verdict is **READY**. This round follows the
operator's narrower ownership boundary rather than extending escape detection.

### Governing context and implementation

The `llp-orient` scope is the test-file runner, its process and reporting
helpers, focused regressions, AGENTS testing notes and LLP 3000's
[publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention).
LLP 3000 is the Snapback 4 root; LLP 2000.000 supplies the design brief,
`rules/RULES.md` the shared-machine rule and `snapback4/NOT-DOING.md` the fence.
No authoring surface or product implementation changes. Hand-off: none.
The operator's Round 6 ruling supersedes the prior escape-detection policy;
AGENTS and the living LLP now describe the actual narrower behavior.

- Each file starts in a fresh process group held by its keeper. Cleanup sends
  one SIGKILL to that group while its ChildProcess handle still holds the
  unreaped keeper. Emergency cleanup uses the same one-shot release. No PID
  discovered by inspection can authorize a signal, and the group is never
  signalled again after release.
- Verification includes the keeper and all other living group members and
  requires two consecutive empty inspections, 50 ms apart, within five seconds.
  Observed leftover members fail as `TEST_FILE_LEAK`; already observed leaks
  remain failures even if cleanup succeeds. Inspection failure remains
  fail-closed, with the first error retained. Vanished members count as exited.
- Ancestry inference, spawn interception/registries, environment tokens, Linux
  environment reading and the Darwin environment helper are deleted. The native
  escape fixture and escape/token regressions are deleted. The watchdog's
  child-leak cases now use in-group children; product assertions are unchanged.
- Reporter counts come from Node's complete `test:summary` event over IPC.
  Passing requires exit status 0, independently reported `fail: 0` and
  `cancelled: 0`, and no watchdog, leak or inspection failure. The failure handler
  respects TODO and skip. A test-authored exit-code override or TAP-looking
  console line cannot erase the reporter's failures.
- Focused regressions compare the exact throwing `beforeExit` override fixture
  and an expected TODO failure with `node --test`. A cancelled-test override
  also stays failed. A stale parent-link injection leaves a separately launched
  sibling alive, and attempting to signal through a reaped keeper is refused.
  Existing in-group orphans, stale/vanished metadata, failed listings, progress,
  stalled JS, console chatter and original replacement assertions remain covered.

**Limitation:** processes that leave the file's group through `setsid`,
`setpgid` or detached spawning are out of scope. They are not tracked, cleaned
up or counted as leaks, regardless of their ancestry or environment. Fixtures
creating such processes must manage their lifetimes. This deliberately removes
the behavior behind Astra findings 1 and 2; it does not claim to fix arbitrary
session escapes. The original flaky incidents were in-group.

The progress watchdog is unchanged: each real subtest start/completion resets
`max(15 minutes, largest single declared guard + max(60 seconds, 25%))`.
Console output is not progress; there is no total-duration cap. The guard
census covers **303 files with zero undercovered guards**.

### Verification record

Focused checks on final source pass **32/32 on eb1000 and 32/32 on the
Apartment mini**, with zero skips, assertion failures or outer file refusals.
The two files are `test-file-runner.test.mjs` and `replacement-fixture.test.mjs`:

```sh
node snapback4/scripts/run-client-tests.mjs 1 files \
  snapback4/packages/snapback4/test/test-file-runner.test.mjs \
  snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

The mini runs the same command in its task scratch with `LC_ALL=de_DE.UTF-8`
and `SNAPBACK4_BIN` pointing to the published `snapback4-darwin-arm64@0.4.10`
fixture binary, as in Round 5. Its ten copied source hashes match. This is
runner and replacement-fixture portability evidence, not a current-release
Mac product qualification. The mini used Node 24.18.0; eb1000 used 24.13.1.
Only eb1000 and the Apartment mini were used. Both mini scratches were removed;
`mini-cleanup.log` and `before-cancellation-mini-cleanup.log` retain receipts.
No office M1 or publication M5 was contacted and no unrelated process was sent
a terminating signal.

The nine fixture-wrapper assertions also pass on the final runner. The first
focused development attempt had one failing assertion: assigning exit status
in the summary handler changed the fixture's observed status to 1, so it no
longer demonstrated independent rejection of a cleared exit code. Moving exit
status handling back to the TODO-aware failure event fixed that ordering.
The retained green 31/31 checks preceded the additional cancellation regression;
the final 32/32 checks supersede them.

The cancellation audit found that Node reports `cancelled` separately from
`fail`; the unamended runner could pass a cancelled test with a cleared status.
The final independent cancellation check and regression were added during the
full suite's Rust phase, before ordinary client execution, and then rechecked
on both hosts. `cancellation-amendment.json` records the timing. The separate
final fixture-wrapper run covers the only JavaScript category that had already
executed. No Rust, product, guard, seed or original flaky-test assertion changed.

The first stress attempt overlapped the suite's wasm regeneration: one target
failed on a missing generated wasm import. It was stopped after 13 attempts per
target; its 23 background aborts and one target abort are operator interruptions,
not runner refusals. The second attempt had 35 successful target completions
and no natural failures before it was stopped to bind the cancellation fix;
its 23 background aborts and one target abort are also operator interruptions.
`preparation-stress/` and `before-cancellation-stress/` retain every result,
failure log and per-failure classification. Neither interrupted run substitutes
for the complete final stress run.

### Single eb1000 full suite

The sole full-suite invocation ran **2026-10-03T05:56:32.992142+00:00–
2026-10-03T06:20:44.828659+00:00**, exit **1**, from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Its exact summary is **`== 1 failure(s) in 1452 s`**. The only failed category
is `cargo test`, containing exactly the four operator-designated UB baselines:

- `snapback4-lang::prefix_reads::explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`
- `snapback4-lang::prefix_reads::prefix_reads_compile_without_notes_and_caps_follow_one_schema_number`
- `snapback4-sim::membership_search::edges::calendar_repair_executes_the_same_offset_boundary_predicate`
- `snapback4-sim::membership_search::refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches`

The names and assertion signatures match Round 5's independent clean-main
reproduction at `1b879881be`; they remain tracked by the existing
[UB ticket](../../../issues/20261003-snapback4-shape-meter-note-breaks-prefix-and-membership-search-tests.md).
No QF, environmental or runner-refusal failure occurred in the suite.
All build, budget, package/app and JavaScript categories pass. Ordinary clients:
**300/300 files, 6,026 passed, 11 existing skips**. Models: **79/79**.
Fixture wrappers: **9/9**. Total JavaScript: **6,114 passed, zero failed or
cancelled, 11 skipped across 303 file results**. The six removed Darwin-only
skips belonged to the deleted escape-inspection regressions; no product skip
was added or changed.

`round6/full-suite.log.gz`, its SHA-256 in `full-suite-summary.json`, the
per-file table and `full-suite-failure-classification.json` retain the full
record. The final source manifest binds all 2,433 selected source paths;
`source-amendments.json` records only the cancellation correction and its
matching testing notes. Binary and wasm inputs are unchanged after build.

### Final 24-file stress

The final run started **2026-10-03T06:01:03.943Z** and drained at
**2026-10-03T06:26:08.916Z**, exit **0**. From `snapback4/`:

```sh
node reports/20261002-qf-qualification-flakes/stress.mjs after \
  reports/20261002-qf-qualification-flakes/round6/stress 200 both
```

The worker regression passes **200/200**, with its intended one test in every
run. The observed-replacement regression passes **200/200**, with its intended
two tests in every run. Every target completion has **23 background file slots
active**, making the requested 24-file pool. All **1,429 background executions
across 300 files pass**, with **zero assertion failures, cancellations or runner
refusals**. All 1,829 results have exit status 0 and nonempty reporter counts.
The full suite overlapped this final stress run after its build phase; no build
inputs changed during the final stress qualification.

`round6/stress/runs.jsonl.gz` retains every result; the summary, load timeline,
`stress-target-summary.json` and independent `stress-stats.json` recount the
claims. Earlier interrupted attempts are classified separately above.
`final-integrity.json` confirms all 2,433 source hashes, ten mini source hashes
and binary/wasm inputs still match. Both requested final reviews are retained
verbatim as `input-final-astra.md` and `input-final-grok.md`; no new reviewer
verdict is claimed for this revision.

The affected documentation audit reconciles LLP 3000 and AGENTS with the new
group-only contract while preserving every historical JOURNAL entry. Reference
and whitespace checks accompany the local commit. The commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing is pushed or published.


## Round 7 — native Node and keeper-owned cleanup

Round 6's Astra review is **NOT READY**, with all three P1s reproduced on
Linux and the Apartment mini: stale JS exit fields authorizing a group signal,
`isolation: 'none'` changing `test.only`, and reporter counts concealing hook
and late asynchronous failures after an exit-code override. The complete input
is retained in `round7/input-astra.md.gz`. This round implements the operator's
replacement architecture and claims no new independent review verdict.

### Context and integration

The `llp-orient` scope is the runner, keeper, reporter, process inspection and
focused regressions. [LLP 3000's publication-suite section](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
(in `current/`, not `foundation/`) governs this scope. LLP 2000.000 supplies the
design brief; `rules/RULES.md` and `snapback4/NOT-DOING.md` supply the fence and
shared-machine constraints. Active constraints are unchanged guards, fail-closed
inspection, vanished-as-exited handling and group-only ownership. The operator's
Round 7 instruction supersedes the old runner-signal and reporter-verdict rules.
The living LLP and AGENTS notes are reconciled in this change. Hand-off: none.

Starting commit: **8c4fadb44e**. Fetched and merged `origin/main`
**484c94733c** in **a46e58a12f**, including UB baseline fix **9c048bf174**.
The only merge conflict was the append-only JOURNAL; both histories are retained.
Outside the main merge, no Rust, product, original flaky-test assertion, guard,
seed or skip changed.

### Implementation and limits

Every file now runs as native `node --test <file>` with default isolation.
Node's own test parent creates the test child and supplies the exit status.
`--test-reporter` attaches an observer through Node's [custom reporter API](https://nodejs.org/docs/latest-v24.x/api/test.html#custom-reporters)
for progress and diagnostic summaries; it contains no `run()` call, isolation
override or exit-code assignment.
Reporter counts do not decide success. Tests compare native exits for `only`,
TODO, skip, assertion and cancellation overrides, `after` failure, uncaught
exceptions, unhandled rejections and explicit successful exit.

The keeper is a 26-line Node helper using the runtime already on PATH; it needs
no compiler, binary distribution or platform-specific build. It starts as the
fresh group's first member, starts native Node within that group, and stays alive
on its stdin pipe after Node finishes. Completion, stall and abort close that
pipe. EOF, including runner death, makes the keeper call `kill(0, SIGKILL)`.
The runner never signals a group or derives signal authority from an inspected
PID or ChildProcess exit fields. An already reaped keeper leaves a broken pipe;
no PID/PGID reuse can redirect that pipe into a signal.

A cleanup acknowledgment distinguishes requested cleanup from unexpected keeper
loss. It is diagnostic only and confers no signal authority. The runner waits
for pipe closure before judging it, since libuv may deliver exit before queued
IPC. Unexpected keeper death fails with `TEST_FILE_KEEPER_EXIT`. Regressions
cover the actual absent-kernel-process/null-JS-fields interleaving, a test killing
its own group, runner death, and the exit-before-acknowledgment ordering. Signal
interception asserts the runner sends no nonzero signal in the hostile cases.

Group verification still requires two consecutive empty inspections 50 ms apart.
Observed in-group leaks fail; failed listings remain fail-closed, vanished members
count as exited, and the first inspection error is retained. Pipe release is
asynchronous, so an orphan newly observed during cleanup also counts as a leak.
Processes escaping through `setsid`, `setpgid` or detached spawning remain out
of scope, regardless of ancestry or environment; fixtures own those lifetimes.

The watchdog still uses `max(15 minutes, largest declared guard + max(60 seconds,
25%))`, with no total-duration cap and no credit for console output. The census
covers **305 files with zero undercovered guards**. **Native buffering limit:**
CPU-bound synchronous tests that do not yield can withhold their lifecycle events
inside Node's child. The observer renews progress only when Node delivers those
events. A regression preserves the original ten synchronous bodies and shows
that a deliberately shortened one-second watchdog expires while native Node
alone passes; the production floor stays 15 minutes. Async/nested progression,
stalled JS, leaked handles and console chatter retain their regressions. This
limit cannot be removed by an observational reporter without changing Node's
execution model again.

### Focused verification and development record

Final focused checks pass **42/42 on eb1000 and 42/42 on the Apartment mini**,
zero skips or outer runner refusals. Both run:

```sh
node snapback4/scripts/run-client-tests.mjs 1 files \
  snapback4/packages/snapback4/test/test-file-runner.test.mjs \
  snapback4/packages/snapback4/test/replacement-fixture.test.mjs
```

The mini uses `LC_ALL=de_DE.UTF-8`, Node 24.18.0 and published
`snapback4-darwin-arm64@0.4.10` for the replacement fixture; eb1000 uses Node
24.13.1 and its rebuilt binary. This is runner/fixture portability evidence,
not current-release macOS product qualification. No office M1 or publication
M5 was contacted, and no unrelated process received a terminating signal.
Final logs, commands, statuses and source hashes are retained in `round7/`.

Development failures are retained rather than substituted for qualification:
`development-linux.log` caught the reporter's constructor-vs-generator interface;
`development-linux-2.log` caught six old assumptions about native subprocess
environment, asynchronous cleanup and progress event counts/buffering;
`development-linux-3.log` caught the changed native cancellation summary;
`development-linux-4.log` caught a TAP parser applied to native spec output.
All were corrected before the final focused runs. The intermediate 41/41 runs
on both hosts precede the acknowledgment ordering regression and are retained
as `before-ack-fix-*`.

The first stress attempt ran 350 file executions before it was stopped: **27
introduced false `TEST_FILE_KEEPER_EXIT` refusals**, caused by testing the cleanup
acknowledgment in the exit callback before queued IPC arrived, and **24 operator
aborts**. Native test assertions all passed in the 27 false refusals.
`before-ack-fix-stress/` retains every result and per-failure classification.
The final fix delays that diagnostic until pipe closure; no signal authority
is added. Source amendment records bind the correction during the full suite's
Rust phase, before ordinary clients. Fixture wrappers are separately rerun on
final source. The final stress run starts afresh after the correction.

### Single eb1000 suite and final stress

The sole `scripts/test.sh` invocation ran on eb1000 from
**2026-10-03T06:56:46Z** to **2026-10-03T07:21:30Z**, exit **0**:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Exact summary: **`== 0 failure(s) in 1484 s`**. Every category passed, including
the now-fixed UB Rust cases. Failure classifications: **introduced 0, baseline 0,
environmental 0, runner refusals 0**. Ordinary clients: **302/302 files,
6,060 assertions passed, 11 existing skips**. Models: **79/79**; fixture wrappers:
**9/9**, also **9/9** in their separate final-source run. Total JavaScript:
**6,148 passed, zero failed or cancelled, 11 skipped across 305 file results**.
The full log, command/status/timing record, per-file results and failure
classification are retained under `round7/`.

The final 24-file stress ran **2026-10-03T07:03:49Z–07:29:12Z**, exit **0**:

```sh
node reports/20261002-qf-qualification-flakes/stress.mjs after \
  reports/20261002-qf-qualification-flakes/round7/stress 200 both
```

Worker **200/200**, with one intended assertion per run; observed replacement
**200/200**, with two intended assertions per run. Every target completion has
**23 active background slots**. All **1,501 background executions across 302
files pass**, and drain naturally. All **1,901 results** have native exit 0,
nonempty diagnostic counts and acknowledged keeper cleanup, with **zero runner
refusals, assertion failures or cancellations**. `stress-stats.json` independently
recounts the retained JSONL, and the failure-classification record is empty.

The harness metadata's `sourceCommit` is its historical before-fix fixture pin;
`source-finalized.json`, the amendment records and built-input hashes bind the
source actually executed in this round. The 2,438 selected source hashes and
three binary/wasm hashes remain unchanged through final qualification. Ten
copied source hashes match the mini; its task scratch was removed after
collection. Inspection escapes remain explicitly excluded, and actual kernel
PID/PGID reuse was not forced. The regression exercises the reaped-before-callback
window and proves no runner signal, without relying on reuse occurring.


The affected documentation audit reconciles LLP 3000 and AGENTS with native
execution, keeper-owned signaling and the native buffering limit. Every earlier
JOURNAL entry remains unchanged. Final reference and staged whitespace checks
pass. Logs and JSONL/load timelines are gzip-compressed where indicated by their
filenames; `summarize.py` reads either representation. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing is pushed or published.

## Round 8 — process-table isolation and Darwin UID parsing

The operator superseded the original mini verification instruction during this
round: **all test execution is on eb1000; macOS execution is pending operator
verification after calibration.** No office M1 or M5 was contacted. Before the
amendment, the original session had copied a scratch tree to the Apartment mini
and started dependency/build preparation (Cargo completed); no test phase ran.
After the amendment only that task's scratch was removed, without signaling
another process. `/tmp/sb4-qf-r8.LXZGaS` is confirmed absent. No macOS test result
or portability qualification is claimed for Round 8.

### Integration, context and policy

Starting from Round 7 `f0a597316e`, fetched and merged `origin/main`
`0185dfd67e`; Git fast-forwarded because main already contained Round 7's merge
and subsequent revert. **`6545d92a6f`** is the separate `git revert a8c20c40e9`
commit reapplying the runner, with main's append-only revert JOURNAL entry
preserved. Main's newer product work remains intact. The commit carries the
required GPT-6 Astra co-author trailer. No push or publication occurs.

`llp-orient` covered the runner, keeper, reporter, process inspection and tests.
[LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
is the governing current LLP; LLP 2000.000 is the design brief. `rules/RULES.md`
and `snapback4/NOT-DOING.md` supply the fence. Native Node's exit status,
keeper-only signaling, two empty snapshots, original guards/seeds and zombie /
vanished-member handling remain binding. No authoring or product surface changes.
The affected documentation audit reconciles LLP 3000, AGENTS and README (whose
restored testing paragraph still described Round 0's obsolete absolute caps and
runner-owned signaling). Hand-off: none.

The chosen rule is now beside the runner rules in LLP 3000 §7:

- Every PID/PPID/PGID prefix must parse. An unclassifiable prefix fails closed,
  even when its apparent PID is absent, since ownership cannot be established.
- Build the complete parent index before selecting metadata. Validate all group
  members and their visible transitive descendants, regardless of row order,
  reparented members, cycles or zombie state. Include descendants of the keeper
  even when the keeper row has disappeared.
- Rows proven outside this set contribute `unrelatedRows` diagnostics, without
  ancillary-field validation or existence probes. Their printing cannot fail a
  file. Selected malformed metadata still refuses while its PID exists; a
  verified disappeared PID remains exited. Preserve first error and exact bytes.
- Descendant selection expands inspection, **not cleanup custody**. The keeper
  still only kills its own group. Escaped descendants are never signaled or
  classified as an in-group leak; fixtures own their lifetimes.

This prevents unrelated formatting from poisoning the verdict without dropping
an unparseable owned candidate. The existing vanished-row test now supplies a
valid routing prefix before truncated metadata; the malformed-parent test is
strengthened to refuse even when an existence probe would report absence.
Neither test is skipped or weakened.

### Field audit and regression evidence

The synthetic recorded fixtures under
`packages/snapback4/test/fixtures/process-tables/` contain no user process data.
`darwin.txt` includes the exact supplied distnoted row, kernel zero IDs, Z,
Ss/S+/SN/Rs/S</SNs/U/I/T, unknown-state `?`, variable lstart spacing, spaced
comm paths, parentheses and `<defunct>`. `linux.txt` includes kernel PGID zero,
Linux states/flags and unsigned UID boundaries. These are synthesized shape
records, **not a captured M5 process table**.

The audit used Apple's [field definitions](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/keyword.c)
and [printers](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c),
and the procps [ps manual](https://man7.org/linux/man-pages/man1/ps.1.html).
The parser accepts UID decimals from -2^31 through 2^32-1, handles C-locale
lstart as five whitespace-separated fields, accepts platform state flags, and
keeps comm as the remaining text. Darwin start identity normalizes whitespace;
Linux retains /proc start ticks. Two-second / 16 MiB listing limits remain.
The ancestry walk is indexed, order-independent and cycle-safe. Tests cover
5,000 mixed Darwin rows and a reversed 5,000-row ancestry table, including a
malformed deepest descendant. Separate assertions cover malformed group,
direct-descendant and transitive-descendant metadata; unrelated metadata is
not even probed. Darwin identity lookup is exercised via its platform branch.

The end-to-end test launches the **real runner CLI** with a `ps` executable
first on PATH. That shim invokes `/bin/ps` and appends the exact supplied row.
It compares native exits, file verdicts, retained assertion errors, diagnostic
counts and continued execution after failure against the no-shim control.
A second shim variant adds malformed ancillary metadata for its own live
fixture PID outside the nested file group and must leave the same verdicts
unchanged. There is no inspection seam in this test.

A subtle counterexample is retained: on Linux, PID 889 may be absent, so the
old parser dismisses the exact appended row as vanished and passes. Therefore
`SB4_PS_NOBODY_PID` optionally adds the real row of a caller-owned live fixture
process with UID rendered as -2. The CLI regression sets it to its own test
process; phase verification uses its still-live script process. Both modes
always append the exact distnoted row. The pre-fix runner passes without the
shim (exit 0) and fails with this live-row shim (exit 1,
TEST_PROCESS_INSPECTION). Final code passes its positive cases and preserves
its intentional failures under both shims. The initial absent-PID control and
the decisive control are both retained under `round8/pre-fix-*`.

Focused eb1000 verification: **64/64** (22 process-table / CLI regressions,
39 existing runner regressions and 3 replacement regressions), no skips.
After adding the live-row counterexample, the 22 process-table / CLI tests
pass again. The final focused run also passes **64/64** after the exceptional
helper cleanup amendment described below. The complete UID shim phases cover
that cleanup. A later scoped-adapter correction receives its own final
64-test checks, both plain and with unrelated malformed metadata, as recorded
below.

### Every M5 runner failure attributed

`round8/m5-failure-audit.json` binds the original full log by SHA-256 and records
each name, line and cause; the numbered runner and replacement excerpts are
retained compressed. The log repeats the same execution as a timeout tail and
final output. There are **19 distinct failed runner subtests**, rather than all
of 1–23 failing. Tests 4, 7, 15, 21 and 24–28 passed before test 29 stalled;
30–39 did not complete. Grouped causes below retain each failed test number:

| Runner test(s) | M5 line(s) | Cause beyond the failure line |
|---|---|---|
| 1, 2: watchdog event loop / leaked handle | 76938, 76959 | Intended hang occurred; Darwin's post-cleanup identity check reread the whole table and threw on distnoted. |
| 3: failure then healthy file | 76979 | The healthy result was false; the old assertion omitted its result. A controlled replay of the old source adds only assertion messages and exposes `inspectionFailure` as the cause. No-shim passes; shim fails. |
| 5: expected TODO | 77008 | Native TODO passes; final cleanup adds inspection failure and makes `passed=false`. |
| 6: stale parent link | 77131 | The seam's real processTable call fails before the stale link can be added. |
| 8: unreferenced group orphan | 77160 | Expected leak becomes inspection failure. The same diagnostic-only replay exposes the exact malformed-row cause. |
| 9: passing double fork | 77186 | ORPHAN_READY is present; inspection replaces the leak verdict. |
| 10: stalled double fork | 77294 | After the intended hang, Darwin identity throws during the orphan-exit assertion. |
| 11, 12, 13: injected listing failures | 77315, 77336, 77357 | The intended exit/timeout/malformed refusal occurs; the subsequent Darwin identity assertion throws on unrelated metadata. |
| 14: locale / empty output | 77378 | Empty-output refusal passes; final identity(process.pid) throws. |
| 16: persistent injected failure | 77405 | Intended refusal is retained; subsequent Darwin identity throws. |
| 17: unsampled orphan | 77426 | Real processTable fails before the seam releases the forking parent; expected leak becomes inspection failure. |
| 18: nested progress | 77532 | Subtests progress and pass; final inspection makes the file fail. |
| 19: console chatter | 77721 | Watchdog fires correctly, but preliminary inspection throws before the asserted owned-process diagnostic. |
| 20: stale exited snapshot | 78077 | Real processTable fails before the seam adds its stale row; leak becomes inspection failure. |
| 22: name/skip filters | 78189 | Selected test and counts pass; cleanup inspection makes `passed=false`. |
| 23: disappearing process | 78292 | Initial processTable throws before the intended disappearance interleaving. |

The **test-29 stall** is at line 76653: the last dequeue names “a completed
file passes when its enumerated group member has exited.” Its nested fixture
calls processTable to save a snapshot **before** ending its helper's stdin.
The parse error rejects the nested subtest while the helper pipe remains held,
so native Node and its nested runner cannot finish before the outer 900-second
watchdog. This source-based attribution is corroborated by a real-shim replay
of the unchanged old test: no-shim completes; shim stalls at the identical
last-progress event. A separate outer five-second control watchdog bounds that
reproduction; it changes no production or existing test guard. See
`pre-fix-snapshot-hang.json` and its logs. This exposed an additional fixture
cleanup defect: snapshot failure bypassed helper release. The snapshot producer
now closes and awaits that helper in `finally`, preserving every assertion.
With the **old parser** and the same real shim, the corrected fixture now
reports a native failure and completes in **809 ms**, without using the outer
watchdog (`snapshot-cleanup-control.json`). The full suite had already executed
this test when this cleanup-only amendment was made; `source-amendment.json`
records that boundary. The final focused run and subsequent complete shim
phases exercise the corrected cleanup.

Final review also found that some real-table inspection adapters in the runner
regressions discarded their requested scope and could themselves reject
unrelated malformed ancillary metadata. They now forward group selectors;
fixture identity lookups select their own PID or group. The stale-parent test
still explicitly fetches and injects its separate live sibling, and gains an
assertion that the injected sibling exists. No original assertion is removed.
`inspection-adapter-amendment.json` records this later test-only delta. The
runner implementation is unchanged from the full suite and complete UID shim
phases. The final checks pass **64/64 without a shim and 64/64 with the real-ps shim
additionally emitting malformed metadata for a live, caller-owned unrelated
fixture PID**, zero skips or refusals. This live PID prevents disappearance
handling from hiding an accidental global validation. The permanent CLI
regression uses the same live malformed-row control. `final-live-*` logs/status,
`live-malformed-amendment.json` and the final source hashes bind that last test
strengthening; earlier development checks remain separately named.

The **replacement regression** at line 62124 emits its intended
`TEST_REPLACEMENT_COPY: writer remained locked for 150 ms` nested failure.
Inspection then adds a runner refusal where the outer assertion requires
`reason === undefined`. The original server-reap, temporary-directory removal
and failure-output assertions remain and are exercised in the final runs.
No additional product or runner-verdict defect was found in these cases; the
test-29 exceptional helper cleanup is fixed as described above.

### eb1000 complete verification

The single full suite ran **2026-10-03T12:10:28Z–12:35:39Z**, exit **0**:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

Exact line: **`== 0 failure(s) in 1511 s`**. Every category passes. Fixture
wrappers: **9/9**. Ordinary clients: **304/304 files, 6,095 passes and 11 existing
skips**. Models: **79/79**. Total JavaScript: **6,183 passed, zero failed or
cancelled, 11 skipped across 307 file results**. Introduced, baseline,
environmental and runner-refusal category/file failures are all zero.
`round8/full-suite-summary.json`, the per-file table, command/status record and
complete log retain the counts. The cleanup-only test amendment and its
affected-source checks are explicitly recorded above and below.

The complete UID-shim repeat ran **2026-10-03T12:35:41Z–12:51:08Z**, exit
**0**, with **the identical counts in all three phases**: wrappers 9/9;
304/304 ordinary files, 6,095 passed / 11 existing skips; models 79/79. Total:
**6,183 passed, zero failed or cancelled, 11 skipped across 307 file results**.
Exact summary: **`== 0 client phase failure(s) (shim)`**. The phase summaries,
per-file table, separate logs/statuses and timing are under `round8/`.

The final affected-source checks (`final-live-*`) both pass **64/64**, with
zero skips: ordinary PATH, then a real ps shim with the exact system row,
live signed-UID row and live unrelated malformed-metadata row. All 39 existing
runner regressions and all 3 replacement assertions retain their verdicts.
This covers the test-only scope forwarding and exceptional cleanup amendments
without repeating unchanged Rust/product checks. No guard, seed or skip changes.
Final source and built binary/wasm hashes agree; reference and whitespace checks
pass. Logs are compressed as recorded by `round8/artifact-index.json`. No new
independent review verdict is claimed.
The baseline's three phases are the unmodified invocations in `scripts/test.sh`;
the shim repeat uses `round8/client-phases.sh`, preserving its exact fixture
invocation, ordinary-file selection/pool and serial full-count model invocation.
No test filter, seed reduction, added skip or guard override applies.

### macOS checks — pending operator verification

**Pending operator verification:** all six cells below, on the Apartment mini
only after calibration. None ran in Round 8.

| Check | Without shim | With shim |
|---|---|---|
| Fixture wrapper tests (`1 files fixtures/`) | pending operator verification | pending operator verification |
| Every ordinary client file (suite CPU-derived pool) | pending operator verification | pending operator verification |
| Full-count client models (serial) | pending operator verification | pending operator verification |

Exact preparation and execution commands, for the operator to run **later**
from this branch on eb1000 (requires the mini's existing Node 24, Bun, Rust
and wasm-bindgen toolchain). Both calls to `client-phases.sh` run all three
listed phases and retain separate logs/status files. The script derives the
same CPU pool and file exclusions as test.sh; it never selects fewer tests.

```bash
mini_scratch=$(ssh ccheever@100.64.36.16 'mktemp -d /tmp/sb4-qf-r8-verify.XXXXXX')
git archive sb4-intent/qf-qualification-flakes snapback4 |
  ssh ccheever@100.64.36.16 "tar -x -C '$mini_scratch'"
ssh ccheever@100.64.36.16 "cd '$mini_scratch/snapback4' && /bin/bash -s" <<'MINI'
export PATH="$HOME/.volta/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
node --version
bun install --frozen-lockfile || exit
cargo build --workspace || exit
bash scripts/build-wasm.sh || exit
bun run --cwd packages/snapback4 build || exit
(cd apps/chat && ../../target/debug/snapback4 check) || exit
bash reports/20261002-qf-qualification-flakes/round8/client-phases.sh plain ../plain
plain_status=$?
bash reports/20261002-qf-qualification-flakes/round8/client-phases.sh shim ../shim
shim_status=$?
printf 'plain=%s shim=%s\n' "$plain_status" "$shim_status"
[ "$plain_status" = 0 ] && [ "$shim_status" = 0 ]
MINI
mkdir -p /tmp/sb4-qf-r8-mini-results
scp -r "ccheever@100.64.36.16:$mini_scratch/plain" /tmp/sb4-qf-r8-mini-results/
scp -r "ccheever@100.64.36.16:$mini_scratch/shim" /tmp/sb4-qf-r8-mini-results/
ssh ccheever@100.64.36.16 "rm -rf '$mini_scratch'"
```

The phase script contains the exact commands: `node scripts/run-client-tests.mjs
1 files fixtures/`, the CPU-derived ordinary client invocation, and
`node scripts/run-client-tests.mjs 1 models packages/snapback4/test/app-session-model.test.mjs
packages/snapback4/test/online-client-model.test.mjs`. Verification does not
publish packages or signal any process outside those started by its fixtures.
