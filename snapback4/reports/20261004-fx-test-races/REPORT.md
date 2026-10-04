# Lane FX — test observation races, 2026-10-04

Base: `c148778aa2dcd12e6e8637b9f8dade8583fd3aaa` (RPF), branch
`sb4-intent/fx-test-races`. Test fixtures and observation barriers only;
product code, assertions, test counts and existing timeout values are retained.

The governing context is [LLP 3000 §publication suite under contention](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
and [§HTTP overload diagnostics](../../../llp/3000-snapback4.explainer.md#http-overload-diagnostics):
state changes and queued diagnostics have separate completion boundaries.
LLP 2000.000 remains the design brief. No new design decision or LLP is needed.

The adoption test waits, within the existing 35-second `wait_adoption` guard,
for a newline-terminated recovery diagnostic after the version-2 query and
successful doctor. Its lock refusal and sweep observations also require
complete lines, retaining all subsequent refusal/recovery assertions.
Worker fixtures write sibling temporary files and rename only after completion.
The two `values` fixtures keep an append-only backing file before copying and
renaming, preserving the original assertion's detection of duplicate writes.

Audit: searched Rust integration and embedded unit tests, JavaScript tests/helpers, Python witness fixtures
and fixture tests for existence/read pairs, live file reads and log assertions;
traced their writers and ordering barriers. Every additional real instance
found is included below. Paths are relative to `snapback4/`.

| File / cases | Completion barrier |
| --- | --- |
| `crates/snapback4/tests/check_adoption/mod.rs`: lock/recovery and startup-lock tests; helper in `check.rs` | Complete refusal, sweep, recovery and startup retry lines |
| Same: external adoption while the host is stopped | Fixture owns SQLite writer lock until `waitpid` confirms SIGSTOP, then releases it for adoption |
| `packages/snapback4/test/worker-regressions.test.mjs`: package lookup (3 cases) | Atomic `package-lookup` JSON |
| Same: schema-local package resolution (4 cases) | Atomic `package-result` JSON |
| Same: automatic/named source replacement (2 cases) | Atomic `values`, preserving append semantics |
| Same: explicit environment (dev and serve) | Atomic `environment-result` JSON |
| Same: checked-import entry-copy case | Atomic `checked-value` text |
| Same: automatic symlink refusal and Node repair admission | Complete diagnostic before asserting its suffix |
| Same: split refresh logging (2 cases) | Complete stdout and stderr records before content/secrecy assertions |
| `packages/snapback4/test/worker.test.mjs`: TypeScript invite and serve restart | Bounded observation of worker PID/restart diagnostic after action/start-file state |
| `packages/snapback4/test/upload-retry.test.mjs`: both capacity cases | Complete overload diagnostic after HTTP refusal |
| `packages/snapback4/test/client-seams.test.mjs`: loopback identity limits | Complete startup diagnostic as delivered on the captured stream |
| `crates/snapback4/tests/lifecycle.rs`: successor refusal | Complete message and rewrite after `check`, beyond the `E_ADOPT` prefix |
| `crates/snapback4/tests/run_admission.rs` and `run_admission/identity.rs`: three startup sites | Complete log line before extracting the announced address |
| `crates/snapback4/tests/witness.rs`: two stalled-checker startup cases | Atomic `checker-pid` |
| `crates/snapback4/tests/fixtures/witness-simctl.py`: fake launch/log-capture handoff | Atomic `waiting` folder path |
| `packages/snapback4/test/test-file-runner.test.mjs`: unsampled orphan | Atomic PID before process identity inspection |

The clean replacement stress pass also exposed an adjacent fixture race in
the external-adoption test: `SIGSTOP` could freeze the host while its sweep
owned SQLite's writer lock. The fixture now acquires that lock, observes the
stopped child with bounded `waitpid` polling, then releases its lock. All
external-adoption, refusal and recovery assertions remain unchanged.

Already-safe cases were left alone: JSONL readers that retry parsing within a
bounded wait; marker-only files whose contents are never consumed; reads after
child completion or an explicit post-write acknowledgement; already-atomic
worker `ready` tokens and publication receipts. The refresh-result file
already waits for its later `refresh-logged` acknowledgement; its independent
stdout/stderr log records now each have their own completion barrier. Rust startup-banner
reads follow the existing writer-flush/readiness barrier. Residency notes
precede the awaited adoption record on the same writer.

At 13:51Z, another run's scratch exhausted eb1000's root filesystem and
interrupted FX's first stress pass. The operator cleared it. All eb1000
measurements overlapping 13:45–13:55Z are excluded from test outcomes, including
apparently completed runs and the client-seams iterations that failed or
exited early. The clean replacement series records per-run timestamps and exit
statuses. The interrupted SSH collector also required restarting the mini's
unrecorded worker repetitions. Its three early recorded completions overlapped
the same window and were also discarded and replaced; every counted repetition
on both hosts is outside the exclusion window.

Validation uses Node 24.13.1 and Rust 1.97.0 on both hosts, Bun 1.3.14 on
eb1000 and 1.4.2 on the mini, and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` for Cargo. Commands run
from `snapback4/`: `cargo test -p snapback4 --test <target> -- --nocapture`
and `node --test packages/snapback4/test/<file>.test.mjs`. Native process exits
decide outcomes. The [validation manifest](./validation.json) and
[per-run records](./repetitions.csv) preserve the commands, counts, source
hashes and log hashes. Every counted run has start/end timestamps and its
native exit status.

| Repetition series | Tests per run | eb1000 | Apartment mini |
| --- | ---: | --- | --- |
| `check` (final SIGSTOP barrier) | 84 | 30/30 passed | 30/30 passed |
| `worker-regressions.test.mjs` | 61 | 30/30 passed | 30/30 passed |
| `lifecycle` | 27 | 30/30 passed | Outside authorized scope |
| `run_admission` | 27 | 30/30 passed | Outside authorized scope |
| `witness` (portable cases) | 31 | 30/30 passed | Outside authorized scope |
| `client-seams.test.mjs` | 65 | 30/30 passed | Outside authorized scope |
| `test-file-runner.test.mjs` | 39 | 30/30 passed | Outside authorized scope |
| `upload-retry.test.mjs` | 35 | 30/30 passed | Outside authorized scope |
| `worker.test.mjs` | 35 | 30/30 passed | Outside authorized scope |
| Refresh-log delta, filtered from worker regressions | 2 | 30/30 passed | 30/30 passed |

The refresh-log barrier was added during the worker-file repetitions; its
additional 30-run series on each host validates that final delta separately.
The original two fixes are present throughout the counted worker-file runs.
A clean intermediate `check` series had two external-adoption fixture failures;
after the SIGSTOP barrier, both final 30-run series passed.

Deterministic probes on eb1000 held the result file empty for 500 ms. The old
fixtures failed all nine selected JSON cases with `Unexpected end of JSON
input` (negative-control exit 1); the patched temporary-file fixtures passed
all 12 selected cases under the same delay (exit 0). The actual witness checker
and fake simctl handoffs also passed 30 delayed-write probes. Darwin-only
witness driver cases were not executed: the mini authorization covers only
`check` and `worker-regressions.test.mjs`. No simulators were used.

Full eb1000 suite (`bash scripts/test.sh`): **exit 0, zero failed stages in
1,616 seconds**. Rust: 4,968 passes and 33 existing ignores; 17 doctests pass.
All 311 client files pass (6,187 tests, 11 existing skips), all 79 serial model
tests pass at their full 5,000/3,000 history settings, and all nine fixture tests
pass. Build, wasm budget, docs budget, release guard and all typechecks pass.
No assertions, model counts or timeout ceilings were reduced.
Owned build targets and scratch stayed below the requested 40 GB limit.
The remote source copy, toolchain, target and test scratch were deleted after
measurement; eb1000's target, suite scratch and stress directories were also
removed. Only the Apartment mini was used remotely, for the two authorized
files. No other worktree or simulator was used. Both tickets are closed;
nothing was pushed.
