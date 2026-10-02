# QF — qualification flakes

Status: complete and locally qualified; no push or publication.

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
