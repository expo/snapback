# QF round 0 — qualification flakes

Status: complete and locally qualified; no push or publication.

Baseline: `850fea99574d969331f68b0df1417ad1f942d2a9`, branch
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
