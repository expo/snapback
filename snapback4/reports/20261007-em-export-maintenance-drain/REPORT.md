# EM — export maintenance drain investigation, 2026-10-07

The [round-4 report](round4/REPORT.md) records the merge of FL's identity-bound
fault dispatch, custody waits and Darwin bindings with EM's bounded diagnostics
and wakeup regressions, with fresh Linux verification before review and the
operator's macOS soak. Both maintenance tickets remain open.

The [round-3 report](round3/REPORT.md) records product fixes and deterministic
positive/negative controls for both wakeup windows identified in round 2. Both
defects now reproduce as stranded requests without their fixes and drain with
them. Attribution to the historical incidents remains unconfirmed; both tickets
stay open for the macOS soak. A later loaded run also failed because native
process-group inspection refused cleanup and parked a claim; its snapshot is
retained in round 3 and linked to the existing inspection ticket. The earlier
investigation below is historical.

The [round-2 report](round2/REPORT.md) supersedes this report's diagnostic capture
implementation and safety claims. It fixes the review's unbounded capture,
stale-process disclosure and FIFO trace blockage. The investigation results
below remain historical evidence; the original cause is still unknown.

The historical intermittent failure remains **unclassified**. The approximately
200 short runs and eight whole-file runs from the interrupted session all passed.
A further 32 repetitions of all four affected Linux cases under bursty CPU/disk
load also passed. Grok subsequently identified an untested lost-wakeup candidate
in the queue audit; see the round-2 correction.
This change adds retained diagnostics; it does not claim a product scheduling fix
or weaken a guard. Both commissioned tickets, and the related FH ticket, remain
open with this evidence. A passing soak cannot resolve a failure whose state was
never captured. The operator's macOS soak remains outstanding.

Work stayed in `~/sb4-intent/lane-em` on eb1000 (OS hostname
`expose-builder-pixel`), branch `sb4-intent/em-export-maintenance-drain`, starting
at `46803201b49980417cc3f2109289c22cbed8a439`. No other worktree, remote host or
other lane's processes were changed. Nothing was pushed. Node v24.13.1; Linux;
all synthetic load and test descendants inherited the named `taskset` affinity.

## Change and retained diagnostics

`retention.rs` adds best-effort, debug-only `SNAPBACK4_DEBUG_RETENTION` tracing to
`artifacts/native-smoke/retention-trace.jsonl`. Each line is serialized before one
append, with epoch milliseconds, PID, step and details. Steps include request
preparation/commit, observer launch/start/exit recheck, coalesced kicks, lease/owner
waits, claim transitions, scan/worker launch, compression/deletion checkpoints,
work completion, cleanup and handoff. Work/cleanup additionally record monotonic
elapsed milliseconds and errors. The trace name stays outside `maintenance-*`,
which the crash matrix correctly treats as protocol inventory. Release binaries
do not write it; neither trace success nor failure determines protocol state.

The shared test file only wires in a separate diagnostic helper and an optional
`SNAPBACK4_EXPORT_TEST_BINARY` path. Its existing `maintenanceIdle` predicate and
90,000 ms guard are unchanged, as are process-identity checks owned by lane FL.
The helper records drain start/end timing, captures on assertion failure before
cleanup, and schedules a snapshot at 110 seconds ahead of the affected cases'
120-second test guard. Snapshots contain:

- Queue and result records, run/native custody journals, lease files and logs.
- Recursive file inventory with sizes, mtimes and inodes.
- Relevant process rows with PID/PPID/PGID, status, elapsed/CPU time and command.
- Linux `/proc` stat/status/wchan, fd targets/fdinfo and relevant lock rows;
  Darwin uses `ps` plus bounded `lsof` instead.
- The retained step trace, including the test's drain timing.

Snapshots survive fixture deletion in `SNAPBACK4_MAINTENANCE_EVIDENCE`, defaulting
to `$TMPDIR/sb4-maintenance-evidence`. Setting the directory also retains successful
cleanup snapshots. These are best-effort observations of a changing process tree,
not an atomic snapshot or authority to signal a discovered PID. Capture errors
are logged without replacing the original assertion. The fixture timer shares
the Node event loop; a blocked loop can delay it. No environment dump is taken.

The stress driver copies each executable into an immutable SHA-256 directory
under this worktree's ignored `target/em/binaries/`. It records the binary hash,
command, host, affinity, worker counts and per-invocation results. Current runs
also record source hashes and load PIDs. It terminates only its own load children.

## Repetitions and measurement

All completed invocations in the following stable-binary cohorts passed. Each
short invocation runs the named set, so `32 × four` means **32 passes per case**.
Every cohort also runs one disk worker unless otherwise stated: repeatedly write
1 MiB, fsync, seek/read, then sleep 20 ms. Reads can be cache hits; this is not a
cold-storage benchmark or proof of disk saturation. CPU workers repeatedly hash
1 MiB buffers. Timing is shared-host evidence, not an isolated performance claim.

| Retained cohort | Completed invocations and selected cases | Affinity / CPU workers / concurrent invocations |
| --- | --- | --- |
| `pinned-baseline` | 60 × deadline off, failed Expo/dead journals off, publication-handoff off/next Expo fails | 80–83 / 8 / 4 |
| `fh-baseline` | 60 × raced retention-lock deferrals | 84–85 / 4 / 2 |
| `pinned-races` | 200 × failed Expo/dead journals, publication-handoff, raced deferrals | 86–95 / 10 / 8 |
| `original-baseline` | 28 × the same three cases, original uninstrumented CLI | 84–85 / 4 / 4 |
| `whole-file-baseline` | 8 × complete file: 58 passes and 36 Linux platform skips each | 80–95 / 0 / 4; overlapped other loaded cohorts |
| `bursty-four-core` | 32 × all four affected cases | 80–83 / 12 / 4; two disk workers; synchronized two-second busy/idle phases |
| `whole-file-final` | Final instrumentation: 58 passes, 36 platform skips, 593.97 s | 84–85 / 4 / 1 |

Together these are **389 completed invocations and 1,574 individual test passes**:
101 passes of the affected deadline case and 329 each of failed-Expo/dead-journal,
publication-handoff and raced-deferral cases. There are nine complete-file passes.
Platform skips and intentional negative-control failures are not counted as passes.

The interrupted original-binary cohort requested 100 invocations but completed
only 28 before the service interruption. Four incomplete logs are retained and
are not counted. Earlier tracing added drain timing partway through some cohorts;
measurement sample sizes below refer only to available completed traces.

The original CLI SHA-256 is
`4ee8e2db8167bd0c9c8acabb5e5f26e3df410bfd4b8358d23239ed7bdb21eed6`.
The repeated diagnostic CLI is
`b4e1d18926df68cd693694c2849d1ab427a80dcffeeb86ac016b40a0e9dbead3`.
The final diagnostic CLI is
`8abc682835af6b5a95fedf3dd672af95fe399d4cff2fdd504b551039e41c7fe8`.
The final revision adds observer/coalescing/handoff trace points and increases the
`ps` diagnostic buffer. The four-core batch keeps its pinned earlier CLI; its
first invocations preceded that diagnostic-buffer change. Queue behavior,
assertions and deadlines are identical throughout these stable cohorts.

Completed drain waits in `pinned-baseline`: n=144, median **1,322 ms**, nearest-rank
p95 **4,035 ms**, maximum **4,718 ms**. `pinned-races`: n=672, median **911 ms**,
p95 **1,070 ms**, maximum **1,170 ms**. The eight complete files: n=536,
median **816 ms**, p95 **1,464 ms**, maximum **2,781 ms**. These exclude the
cleanup-only `allowParked` wait, which is measured separately.

The new four-core batch measured n=160 drain waits: median **706 ms**, p95
**1,615 ms**, maximum **2,140 ms**. The final whole-file run measured n=67:
median **911 ms**, p95 **1,622 ms**, maximum **1,916 ms**.

In `pinned-baseline`, successful native work took at most **3,363 ms** (n=291).
The 60 deliberately stalled compressors reached the real work deadline at
30,000–30,021 ms; the longest work-plus-cleanup interval was **31,033 ms**.
Long short-case durations primarily include creating many real fixture exports
under contention; they are not equivalent to drain duration. Nothing measured
supports increasing the 90-second guard. The complete per-case and per-step
statistics, including the new four-core batch and final file, are in
[`evidence/summary.json`](evidence/summary.json).

## Negative controls and excluded experiments

`negative.py` makes a temporary sibling copy of the actual test module, adds two
controls, and selects only those controls. It neither rewrites the drain
function nor shortens its timeout. The temporary source is removed afterward;
its hash and exact appended tests are retained. Under the four-core load:

1. Hold a real retention lease beyond 90 seconds. The assertion fails with
   `coalesced maintenance queue drained`. Snapshot `sb4-background-mqHQtT` shows
   the owned Python lease holder, observer PID 2046374, a pending request and
   repeated `wait-retention` steps. Releasing the lease lets cleanup drain.
2. Kill the fixture's idle observer while the lease is held, then release the
   lease without scheduling another export. The same assertion fails. Snapshot
   `sb4-background-ma8VJy` shows pending work, no maintenance process and no held
   fixture locks. A later fixture export re-arms maintenance and cleanup drains.

Both intentional failures, with zero cancellations, are retained in
`negative-current.tar.gz`; combined duration 185.016 seconds. The earlier held-
lease negative control is also retained in `negative.tar.gz`. This demonstrates
that the check still detects both blocked live custody and queued work with no
scheduled observer.

Every development failure is retained and excluded from the passing-soak claim:

- `baseline`: two invocations lacked the generated CLI resolver in the fresh
  worktree. Dependency installation and resolver emission supplied the fixture
  prerequisite. The broad TypeScript package build encountered missing generated
  wasm modules; no successful complete package build is claimed.
- `baseline-ready`: two invocations exposed an instrumentation mistake: the
  original `maintenance-trace.jsonl` name violated the crash case's empty queue
  inventory assertion. Renaming it to `retention-trace.jsonl` corrected that.
- `reproduce`: eight passing invocations, then four failures; and
  `deadline-reproduce`: ten passes, then two failures. These overlapped rebuilding
  the live executable. Captured evidence has `E_WITNESS_PROCESS: No such file or
  directory`, pending requests and no surviving observer. Linux `current_exe()`
  resolves an unlinked running executable with the ` (deleted)` suffix, which
  this code then tries to spawn. This is an experiment confounder, not evidence
  that the historical Linux or macOS incidents had the same cause. Pinning the
  executable prevents further contamination. No speculative product change to
  executable lookup is included.
- Initial `writeln!` tracing could interleave serialization across processes;
  final tracing builds each JSON line before appending it. All stable measured
  traces parse without malformed lines.
- `whole-file-final-launch`: an empty Node name-pattern argument refused before
  any test ran (exit 9). The corrected `.*` invocation is separately retained.

The supplied mini log is copied from the local ops directory as
`mac-run7.log.gz`. It records the failed-Expo/dead-journal off case at about
106 seconds, without a queue/process snapshot. No Mac was accessed.

## Queue and wakeup audit

The governing constraints are LLP 3000.030 §15's NZ rounds 6–11: one coalesced
pending observer, a separate scan custodian, durable claims, birth-matched
ownership, 30-second native work plus existing WD cleanup, inherited 60-minute
observation expiry, and next-export recovery for deliberately stranded states.
The audit covered `retention.rs`, its `recovery.rs` producers, `background.rs`
spawn/lease transfers, publication handoff and the Expo wrapper preflight.

| Transition | Wakeup coverage and open cases |
| --- | --- |
| Request while observer is running | Producer atomically publishes pending before `kick`; a busy next lease coalesces with its holder, which loops on runnable pending/claimed state. |
| Request races observer exit | The ordinary observer drops its lease before rechecking. **Open suspect from Grok:** `kick_until` can acquire the lease, find no runnable work and return success while still holding it. A producer committing between that last check and unlock can coalesce against the exiting caller. This path needs a regression; it is not established as the historical cause. |
| Request races scan acknowledgement | Claim and fresh pending use separate pathnames. Acknowledgement renames only the old claim; it cannot erase the new request. |
| Readiness changes after probing | Worker deferral publishes a new pending request before acknowledging its claim. Handled lock refusal does not consume the failed-start budget. |
| Scan hands off with more work | It publishes handoff under the active lease, releases it, and remains a passive backup until work is covered or a birth-matched live successor scan is recorded. Merely seeing a busy observer lease is not acknowledgement. |
| Either peer dies during claimed work | Surviving observer retries after owned native cleanup, or surviving custodian preserves the claim and re-arms observation with the original expiry. |
| Publisher dies before any maintenance request | The next wrapper inventories runs and re-arms before Expo, including when Expo subsequently fails. |

There **are** paths with durable work and no scheduled wakeup: idle observer
cancellation, host sleep/expiry, launch or record I/O refusal, exhausted startup/
claim retries, known parked worker errors, simultaneous loss of both peers, and
death before a peer exists. A failed proof-bound cleanup likewise leaves a
request without starting an immediate persistent-error retry. These are explicit
next-export-backstop cases in §15, not acknowledgements of completion. The
wrapper's maintenance preflight also has a five-second process timeout; killing
it during launch can enter that documented interrupted-launch case. The
90-second test correctly refuses if no later scheduling opportunity repairs it.

No captured historical evidence establishes one of these paths, a leaked lease,
PID reuse, or genuine maintenance slowness. The negative controls prove that
retained evidence now distinguishes the first two broad states. On recurrence,
read the queue/result records first, then the last completed trace transition,
matching process/descriptor state and error logs. Preserve the original snapshot
before running the next-export backstop. Lane FL's process-identity work remains
separate; this lane changes no liveness interpretation.

## Verification and handoff

The final CLI build and the two existing retention unit tests pass. JavaScript
syntax checks and `git diff --check` pass. Final reference validation passes
(531 LLP documents, zero errors/unchecked refs); its log and final whole-file
totals are retained with the evidence. No wasm, SDK, publication or real simulator qualification is
claimed. The Linux tests use their existing owned tool fixtures.

For the operator's macOS soak, build the debug CLI once, copy it to a stable path,
and use the unchanged test with retained successful and failing evidence:

```sh
cd snapback4
cargo build -p snapback4
mkdir -p target/em-mac
cp target/debug/snapback4 target/em-mac/snapback4
SNAPBACK4_EXPORT_TEST_BINARY="$PWD/target/em-mac/snapback4" \
SNAPBACK4_MAINTENANCE_EVIDENCE="$PWD/target/em-mac/evidence" \
  node --test packages/snapback4/test/export-background.test.mjs
```

For Linux reproduction, from `snapback4/`, use `stress.py` with the exact arguments
in a cohort's `host.json`. The four-case regex is recorded there. Synthetic load
is lane-local and the script returns nonzero on any unexpected test failure.
`negative.py` returns zero only when both intentionally stalled tests fail for
the original drain assertion and both timeout snapshots exist.

Cohort archives retain raw TAP logs, host/command receipts, results and complete
captured diagnostics. [`evidence/archives.json`](evidence/archives.json) records
sizes, file counts and SHA-256 hashes. `archive.py` verifies every archived file's
bytes before pruning its lane-local raw copy. `analyze.py` recomputes the summary
from directories or archives; it counts completed invocations only. The initial
instrumentation patch is retained as development evidence, and the final source
manifest/patch identify the shipped diagnostic delta.
