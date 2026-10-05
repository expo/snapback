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

## Round 1 — merged audit and complete observations

Merged `origin/main` (`cb7833c881`, including DG, SU, LU and MS) at
`cee23d5619`, keeping both JOURNAL histories. The three Astra P2 findings
are fixed without changing production code, assertions, test names or existing
timeout values:

- DG's 12 symlink-dependency cases atomically publish `data/package-result`.
- The dev redaction test awaits complete records from both worker streams.
- Measured-cut and suppressed-cut observations await complete lines; the Rust
  cascade footer wait includes its final newline.

The merged-tree audit also fixed worker PID diagnostic observations in
`server-e2e` (four sites) and `routes`, independent stdout readiness in
`supervised-workers`, two atomic worker PID files in Rust `lifecycle`, and
complete-line reads for native lock readiness, runner group PIDs and the load
helper's PID list. The upload-capacity fixture accumulates TCP data through
the `100 Continue` status line before its original assertion. Readiness parsers require the line
terminator after the port: 81 regex uses across 63 files. The exact site list is
[round1-readiness.csv](./round1-readiness.csv); all fixes and safe exclusions
are listed in [round1-audit.json](./round1-audit.json). DG's recipe `paths.json`
read already follows its second acknowledged append, and its explicit-environment
fixtures retain the earlier atomic publication. Their original lookup,
module-path, cwd and environment assertions are unchanged.

Controlled 500 ms probes reproduce the old DG JSON, cross-stream redaction,
measured-cut, partial-port and native-lock failures and pass with the repairs.
Splitting all 32 HTTP `100 Continue` replies likewise fails the old first-chunk
assertion and passes the accumulated-line barrier. A real 150 ms SQLite writer
lock fails all three direct-acquisition controls and passes their bounded retry.
The repaired Rust cascade passes the delayed-final-newline probe. The initial
package probe did not inject the delay into the sanitized worker environment;
its replacement uses an explicit Node wrapper. The initial URL probe stopped
before any port digit and did not reproduce the race; the corrected probe
splits after the first digit. Both preliminary results are retained and are
not counted as reproductions. AST comparison preserves all 4,999 assertion
calls and every test name across the 69 changed JavaScript files; the Rust assertions are unchanged.

A stress repetition also hit `SQLITE_BUSY` while establishing a deletion fixture's
writer lock. The two deletion cases and the revocation case now retry only that
setup error through the existing bounded helper. A worker marker or completed
HTTP request cannot acknowledge another SQLite writer. Final-source worker-file
qualification excludes earlier and in-flight runs after this change; their
results, including the failure, remain in the evidence.

Verification: the final Linux qualification is **71 complete file series ×
30 runs = 2,130 invocations: 2,123 passes and seven failures**, all seven in
`retained-history.test.mjs` (23/30). Every invocation ran under a four-CPU
`taskset` with a live CPU hog; each hog was reaped. All other files passed
30/30, including the final worker, server-e2e and upload revisions. The shared
load helper also passed 30 full-file consumer invocations. The 75 intermediate
Linux runs remain in the archive, including the one pre-fix writer-lock
failure; they do not replace final-source runs.

Apartment mini: both worker files passed **30/30 final-source runs** (77
worker-regression cases and 35 worker cases per run). Twelve earlier-revision
worker-regression invocations also passed and remain intermediate evidence.
Only the two authorized worker files ran there, inside the owned `/tmp` scratch.

The full eb1000 suite (`bash scripts/test.sh`) **passed, exit 0, zero failed
stages in 2,072 seconds**: 4,972 Rust passes, 33 existing ignores, workspace
doctests, all 311 client files (6,204 passes, 11 existing skips), all 79 serial
model tests at full 5,000/3,000 histories, nine fixture tests, and all
build/budget/typecheck stages. Its CLI hash matches the repetition binary.

The stress run reproduced the already-open
[retained-history transient-empty defect](../../../issues/20260929-snapback4-retained-history-transient-empty.md).
The merged-baseline test also reproduces the same assertion in a 30-run
filtered control. These are genuine product-race failures, retained as such;
the R5 assertions and runtime are unchanged. The passing full-suite run does
not establish that this separate defect is repaired.

Round 1 uses Node 24.13.1 and Rust 1.97.0 on both hosts, the existing SQLite
build flag, and `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_INCREMENTAL=0` to bound build storage. These remove debug symbols and
incremental caches; default test/debug assertions remain enabled. The full
suite uses the same build environment as warming and repetitions. No model
counts or hang guards are reduced. Raw compressed output, native child exits,
source hashes, affinity/hog records, probe controls and commands are retained
in [round1-evidence.tar.gz](./round1-evidence.tar.gz). The
[manifest](./round1-validation.json) and [per-run CSV](./round1-repetitions.csv)
identify every qualified invocation; driver exits alone do not decide test success.
The surviving Round 0 full-suite log was also recovered and [retained](./round0-full-suite.log.gz); its SHA-256 matches the
original manifest.

The 13:51Z disk-full event interrupted the first Round 0 stress pass, as
recorded above. None of that interval is reused as Round 1 test evidence.
The local target was 9.3 GiB immediately before deletion; suite scratch was
24 MB and dependencies about 603 MB. The disk sampler stopped on a failed
`du` of live scratch; its
stderr was suppressed, so the exact cause was not retained. Final stable
measurements supplement those samples. Mini scratch was about 1.5 GiB.
These observed allocations stayed well below 40 GB. The local target, suite
scratch, stress evidence directory and the mini scratch were deleted after retaining and verifying their evidence.
No push or publication.

Grok follow-up on `12b101b76b`: the witness memory parser now finds
`scene-peak-bytes=` after libtest's unterminated banner. The Rust audit found
and fixed the same assumption for `FDL_ADDRESS=` in `http_emfile.rs` and
`NA_` records in `acquisition_crash.rs`. All existing assertions, including
`many < one + 16 MiB`, remain unchanged. On eb1000, the full witness binary
passed **30/30** (31 tests each) and `http_emfile` **30/30** (nine each),
pinned to CPU 0 with a live busy loop. The full acquisition-crash binary
also passed on CPU 0 with the hog, retaining all 48 process kills. Direct
child probes reproduce the banner-sharing records that the old parsers miss.
FY's exact 500 ms whole-refresh observation delay passes both worker cases
on this tree; removing only the existing stream barrier fails both. Telemetry
confirms the stderr marker and complete split record precede the delayed
whole record. No worker edit was needed. The round-1 full suite stands, as
requested. The [follow-up manifest](./round1-followup.json) and
[raw evidence](./round1-followup.tar.gz) retain commands, source hashes,
audit exclusions and controls, including an initial witness series repeated
after correcting when the driver sampled hog affinity. The 436 MB target
and owned scratch were removed after verification; nothing was pushed.

## Round 2 — keep readiness streams separate and parse whole measurements

On `0edf7c4690`, fixed both Astra P2s with test-only changes. All 79 combined
readiness reads in 62 files now use a stdout-only capture registered before
readiness callbacks; diagnostic logs still retain both streams. The existing
newline requirement, waits and guards are unchanged. The other two entries
in the Round 1 CSV already used stdout only. The
[site audit](./round2-readiness.csv) lists every entry, including shared
fixtures and restart readers; the archive contains the wider search and safe
exclusions. The new regression interleaves stderr between stdout port digits
and between the port and its LF/CRLF terminator, preserving the complete port.
It passes 2/2 and fails 2/2 when the capture deliberately combines streams.
Astra's real-startup 500 ms interleaving reproduces the parent's 122-second
`TEST_HANG` and passes on the final source.

The witness parser finds the marker after a libtest banner and parses its
entire line value as ASCII digits fitting `u64`. It restores **first-record
semantics**: the child emits one measurement, and a later smaller value must
not hide a malformed or larger first measurement. The unchanged memory
assertion remains `many < one + 16 * 1024 * 1024`. HTTP-descriptor and
acquisition parsers also select the first marker on a line and consume the
whole value. HTTP still uses `SocketAddr` parsing; acquisition now rejects
extra tokens that its old `split_whitespace().nth(1)` silently ignored.
All three reject `12x345`, `1e9`, signs, overflow and extra values; permanent
regressions cover both banner placements and duplicate markers. Extracted
final helper/test probes pass 3/3; adapted parent expressions fail 3/3.

AST comparison preserves all 4,534 existing assertion calls, test names and
timeout expressions in the 62 touched JavaScript files. All 302 original
Rust assertion source lines are preserved. Product code, model counts and
hang budgets are unchanged.

On eb1000, **63 JavaScript file series × 30 = 1,890 invocations: 1,874 passes,
16 failures**. This covers all 57 changed test files, five complete consumers
of shared helpers and the new regression; the full suite covers the remaining
transitive consumers. Each invocation ran under a four-CPU `taskset` with a
live hog. **All three full Rust binaries passed 30/30 on CPU 0 with a busy
loop**: witness 32 tests/run, HTTP descriptors 10, acquisition 3 including
all 48 process kills. Every native exit, log hash, affinity and cleanup
receipt was checked; test sources and Rust binary hashes remained unchanged.
The [per-run CSV](./round2-repetitions.csv) records all 1,980 invocations.

All 16 stress failures remain test failures, with no infrastructure exclusions:

- Four reproduce the open retained-history R5 transient-empty assertion.
- Two hit the wasm same-key row arrival/delete condition guard. Thirty whole-file
  parent controls gave **29 passes and one identical timeout**; its root cause
  remains open. An initial progress update said 30/30 based on the latest log
  lines; the complete-record check corrected that before reporting evidence.
- Ten remain unclassified: seven `fetch failed` errors, two worker-recovery
  attempt assertions in server-e2e, and one missing `E_BOUND` in sync-overflow.
  One whole-file parent control each for server-e2e, sync-overflow and
  admit-before-identity passed; those passes do not classify the stress reds.

[Failure records](./round2-failures.json) retain names, iterations, assertions
and log hashes. These are distinct from Astra's separate retained-history
**MQ query-count** failure (67/68, calls 3 expected 2). Its 30 isolated
baseline controls passed; that finding remains unclassified and was not
investigated in this lane, as requested.

The full eb1000 suite (`bash scripts/test.sh`) **passed, exit 0, zero failed
stages in 2,082 seconds**: 4,975 Rust passes, 33 existing ignores,
workspace doctests, all 312 client files (6,206 passes, 11 existing skips),
all 79 serial model tests at full 5,000/3,000 histories, nine fixture tests,
and every build/budget/typecheck stage. Its CLI hash matches the repetition
binary. This pass does not erase or classify the stress failures.

The [manifest](./round2-validation.json) and
[raw evidence archive](./round2-evidence.tar.gz) retain commands, native
receipts, source hashes, controls, all stress failures and full-suite output.
Node 24.13.1, Rust 1.97.0, SQLite's publication flag and the same no-debug-symbol,
non-incremental Cargo environment as Round 1 were used; default test/debug
assertions remain enabled. The initial new probe compile error was repaired
before qualification and is retained as development output. The original
13:51Z disk-full interruption remains disclosed in Round 0; no Round 2 run
overlapped it or was excluded. Observed build, dependency and
scratch allocations peaked at 12.29 GB, below 40 GB. The sampler continued
through 8 transient `du` errors as live files disappeared; their stderr is
retained. Completed stress/control scratch was removed promptly. The final
local target and remaining owned scratch were deleted after archive verification. No remote machine,
push or publication.

FY integration: merged `origin/main` at `6594e93d40` (including
`c738607178`) into `665df05f6e`. Kept FY's pre-maintenance scheduled-job crash
gate and cleanup that preserves body failures, alongside FX's stdout-only,
complete-line readiness. The worker auto-merge retains FY's identity-based
watchdog checks and all FX atomic-file, log-observation and lock-setup fixes.
No new HTTP readiness reader was added by FY. Both JOURNAL histories are
preserved; the merge preserves all 318 FY assertion calls and every test name
and timeout expression in the three files.

The requested release-activation, worker-regressions and cleanup files each
passed **10/10** complete runs under a four-CPU `taskset` with a live hog
(18, 77 and six tests/run respectively). The merged full suite
(`bash snapback4/scripts/test.sh`) **passed, exit 0, zero failed stages in
2,045 seconds**, retaining the full 5,000/3,000 model histories. The
[merge manifest](./round2-integration.json), [30-run CSV](./round2-integration.csv)
and [raw archive](./round2-integration.tar.gz) retain both parent hashes, the
resolution audit, native exits, affinity, source/log hashes and suite output.
Observed build/dependency/scratch use peaked at 11.68 GB; the archive retains
the four transient disk-sampling errors as live files disappeared. Every hog
was reaped; owned target and scratch were deleted after archive verification. Earlier Round 2 stress
failures remain recorded separately. No push.
