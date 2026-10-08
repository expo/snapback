# EM round 9 — Darwin retention priority and deterministic semantic fixtures

2026-10-08. Base `e408e47929`; all implementation and verification ran on
eb1000 in lane-em. No Mac was contacted, no other worktree/process was touched,
and nothing was pushed or published. Both original maintenance tickets and the
round-8 incident ticket remain open for the operator's macOS qualification.

## Finding

The round-8 capture identifies this recurrence: maintenance received its wakeup,
made progress, exceeded the work deadline, cleaned up, and parked its claim.
The drain assertion correctly refused parked work. This is not the stranded,
unobserved request reproduced by the earlier wakeup controls.

The supplied six-run soak of `e408e47929` passed wakeup 22/22 and background
runs 1–5 at 95/95. Run 6 was 94/95, failing the 28-skipped-export drain.
The exact input [archive](evidence/em-r8-mac-run6.tar.gz) has SHA-256
`b7b48b6d17e2e07210db515740a422f1f0573d524d61cb2e8b123eb394d381fd`.
[analyze.py](analyze.py) reads its
`snapshot-1791428318052862000-2de450ff-failure-drain-timeout` without executing
or extracting its contents into a fixture. The derived
[analysis](evidence/snapshot-analysis.json) preserves the queue records and
selected trace events.

| Event | Trace wall time (epoch milliseconds) | Meaning |
|---|---:|---|
| Observer 55635 adopts and consumes wakeup | 1791428227869–7871 | Notification reached its observer |
| Scan 56995 launched / work starts | 1791428228553 / 8624 | Work was claimed |
| Retention worker launched | 1791428229527 | Native custody acquired |
| First recorded `compress-before` | 1791428245309 | 15.782 s after worker launch |
| Work deadline | 1791428258896 | Explicit 30-second error, elapsed 30.271 s |
| Native cleanup complete | 1791428259560 | Elapsed 30.936 s |
| Scan hands off / observer reaps it | 1791428259611 / 9624 | Handled failure, successful custodian exit |

There are 39 recorded compression commits. The 33 paired trace intervals range
from 14 to 3,157 ms (median 53 ms). Six commits lack a recorded preceding event:
tracing is best effort, so these are not a complete compressor profile or CPU
measurements. The snapshot has `maintenance-parked.json` with state `claimed`,
attempts 1, and a `maintenance-result.json` with the deadline error and
`pending: true`. No recorded process was still admitted as alive. Stale launch
journals and the presence of a lock file are not evidence of held custody.

## Policy reaches the delayed work

The two Darwin launch sites both used `/usr/sbin/taskpolicy -b -c background`
before this change, and still do by default. Apple's
[taskpolicy manual](https://github.com/apple-oss-distributions/system_cmds/blob/main/taskpolicy/taskpolicy.8)
specifies inherited scheduling/I/O policy. Its
[implementation](https://github.com/apple-oss-distributions/system_cmds/blob/main/taskpolicy/taskpolicy.c)
applies `PRIO_DARWIN_BG` for `-b` and a spawn QoS clamp for `-c background`.
[XNU task policy](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/task_policy.c)
maps these requests to low CPU priority and background I/O tiers.

| Process | How it receives production policy |
|---|---|
| Maintenance observer | `retention::kick_with` launches through taskpolicy |
| Maintenance scan | Direct child of observer; inherits policy |
| Retention supervisor, anchor, worker and gzip | Descendants of the scan; no priority reset |
| Background proof custodian | `background::schedule` launches through taskpolicy |
| Proof driver and pre/post-driver retention | Descendants of that custodian |
| Owned simulator app | Separate `lower_app` setter, unchanged |

Changing a process group/session does not undo this policy. The foreground
export wrapper/Expo is not lowered. An explicit retention invocation inherits
its caller's policy. Linux has direct launches without this Darwin mechanism.

The 15.782-second gap and costly compression fit discretionary background
scheduling under concurrent I/O. The archive cannot separate scheduler delay,
I/O throttling and other syscall waits; it has no kernel throttle counters.
The normal-priority Mac soak below tests this explanation. Round 7's 80-second
trace gap is compatible with the same family, but its incomplete capture does
not establish the exact wait in that individual run. The separate unchecked
whole-table `ps` observer-count failure remains FL round 10's issue; it is not
changed here.

## Product behavior preserved

The work budget stays 30 seconds. Cleanup keeps its existing bounds. A known
failure with a live observer parks the claim after cleanup rather than granting
another work budget. A separately pending fresh request can proceed; otherwise
the next export's pre-Expo backstop requests and resumes maintenance. Committed
compressed receipts survive. Cancellation of an uncommitted compression keeps
the original evidence under the existing atomic commit protocol.

Automatic continuation after partial progress is deliberately deferred. There
is no authoritative progress receipt; the trace can drop events. Safely granting
another chunk would require distinguishing the work deadline from cancellation
and cleanup failure, recording progress, and defining retry/backoff within the
same intent. Repeating any failed scan would defeat the existing no-spin rule.
That is more than a simple scheduling fix and could increase sustained Mac work.
Production continues yielding to the developer, with no guarantee of a full
drain under continuous contention without another export.

## Fixture change

`export_policy.rs` centralizes the existing two launch recipes. Only a debug
build with the exact private value `SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY=1`
skips both Darwin flags. Release builds do not read the variable and cannot
select that path. There is no public CLI option or change to production defaults.
It inherits the runner's ordinary policy, rather than raising an already
backgrounded tree. The separate simulator-app setter is unchanged.

The background and wakeup fixtures opt in themselves. Proof entry checks expect
policy 0 for this fixture and policy 1 otherwise. Two new Darwin tests record
and assert actual self-policy for the maintenance observer, proof custodian
and driver, once with the override explicitly removed and once enabled. They
exercise small empty-history fixtures; only their policy-startup wait is 90 s.
The observer exposes its policy in the existing debug barrier, compiled out in
release. These tests also reject an already-backgrounded test runner.

All existing semantic checks, fault dispatch, identity binding, diagnostics and
custody waits stay intact. In particular `maintenanceIdle` and its 90-second
guard, and the 30-second `background proof and post-driver retention finished`
wait, are unchanged. Both reported retention scenarios use the normal-priority
fixture. Severe host starvation can still fail a bounded test; this change
removes the deliberate discretionary policy from semantic qualification.

## Linux verification and controls

The CLI was pinned by content before testing:
`be70c0b0520f174618599ea68f98c43840880f77dc58b2504ba07ef9094d428d`.
The separately pinned native test executable and sibling CLI are recorded in
[unit-binary.json](evidence/unit-binary.json). `check.py` retains each command,
exit status, elapsed time and output without environment dumps.

| Check | Result |
|---|---|
| Export background, including both affected scenarios | 63 pass, 34 Darwin skips |
| Wakeup, sleep, drift, deadline and publication regressions/positive controls | 22 pass |
| Retained diagnostics, including FIFO sink and custody inventory | 6 pass |
| FL signal helpers | 9 pass |
| Combined shared-runner files | 100 pass, 34 skip; 4/4 files, no leaks |
| Native retention / recovery / sleep clock | 8 / 25 / 1 pass; recovery parallel |
| Native policy tests | 2 pass |
| Policy module, debug assertions enabled / disabled, override set | 2 / 2 pass |
| Release `cargo check -p snapback4` | Pass |
| Held-lease and missing-observer stalls | Both fail the original 90-second assertion, then clean up |
| `../ref-check --root .. --verbose` from `snapback4/` | Pass, zero errors |

The [suite receipt](evidence/suites.json) records 379.90 s. The two stall controls
take 182.52 s together and preserve their timeout snapshots. The
[policy harness](policy-check.py) compiles the actual std-only policy module in
both configurations. Its release negative control removes the debug gates:
the same tests then fail (exit 101), demonstrating that release inertness is
checked. These are Linux command-selection tests, not Darwin runtime proof.
The earlier rounds' separately mutated wakeup/sleep/deadline/publication
binaries were not rebuilt; their unchanged regressions ran against this binary.

The evidence archive verifies 12 snapshots and 454 private files before removing
only this report's unpacked snapshots; its manifest retains hashes and permissions.
[Preservation checks](evidence/preservation.json) confirm the original drain
function, post-driver wait, fault helpers, trace sink, native custody, work budget
and wakeup consumption remain unchanged. The `ref-check` receipt is retained
alongside the test receipts. Eight raw logs/diffs with whitespace at EOF or in
diff context are retained losslessly as gzip, with hashes in `log-archives.json`.
No new Mac results are claimed.

## Run on the mini

From this revision's `snapback4/` directory, using Node 24 on PATH and a
normal-priority terminal/SSH shell (not a shell launched with taskpolicy):

```sh
bun install --frozen-lockfile
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=4 cargo build -p snapback4
python3 reports/20261008-em-export-maintenance-priority/mac-soak.py --out "$PWD/target/em-r9-mac" --runs 6
```

Use a new `--out` directory for every invocation. A debug build is required.
The [soak runner](mac-soak.py) pins the exact built CLI, retains its digest and
each log/result/snapshot privately, runs the two policy cases first, then the
wakeup and diagnostics files, then six complete background suites. It removes
any ambient fixture override; each semantic fixture supplies its own, while
the production-policy fixture explicitly unsets it. No production export is
run at elevated priority by this script.

Expected: policy 2/2; wakeup 22/22; diagnostics 5 pass/1 Linux-only skip;
background **97/97 per run** (95 existing plus two policy cases). All six runs
use the existing assertions and bounds. If preflight fails, inspect its log
before soaking. Keep the output directory, especially any initial failure and
cleanup snapshots. If the unrelated old `ps` inventory error recurs on this
branch, report it separately to FL; do not weaken its count assertion.

The operator must supply the real Darwin policy and loaded-host evidence before
closing the maintenance tickets. Linux cannot establish that this seam resolves
the Mac timeout or reproduce background I/O throttling.
