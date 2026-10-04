# WD — witness cleanup on a busy Mac

2026-10-03, Apartment Mac mini, branch
`sb4-intent/wd-witness-cleanup-deadline`; base
`7c9c0c0dabb0528cdee438222bb7eec46e828f16`. Local work only; nothing pushed.
All fifty loaded witness-module runs and all sixteen controlled native exports
passed. The canonical full suite completed with one fixture-teardown failure,
documented below; it is not claimed green.
[Resolved deadline ticket](../../../issues/closed/20261003-snapback4-witness-preparation-cleanup-deadline-flakes-on-busy-macs.md).

## Change and custody

Darwin `members()` now calls `proc_listpgrppids` for the selected group, grows
full buffers, distinguishes inspection errors from an empty result, and checks
each returned member's current group, live state and birth using `proc_pidinfo`.
The API's input is bytes and its result is a PID count; Apple's
[libproc implementation](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c)
and the installed Xcode SDK declarations were checked. Linux reads `/proc`,
filters `stat` by pgid, excludes zombies and retains boot/start identities.
Neither implementation launches `ps`.

The caller, native supervisor and recovery drain now allow five seconds without
an observed reduction in live group membership, with a sixty-second hard cap.
Growth, unchanged membership count, repeated empty snapshots and a merely live
supervisor do not renew the deadline. Shrinkage after late arrivals does.
Recovery and supervisor reaping-lock waits are bounded too. A caller's retry or
Drop retains the original deadline. Real stalls retain `E_WITNESS_PROCESS` /
`recovery required`.

The native anchor remains unreaped through drain, the guardian and birth checks
remain, recovery still holds the reaping lock and signals the whole group, and
both drain paths still require two empty snapshots separated by 20 ms. Existing
NX tests were not edited: [test-body hashes](nx-test-preservation.json).
The prior external-reaping/reuse race, deliberate group escape and
uninterruptible kernel/scheduling stalls remain limits; this is no new absolute
orphan-free or wall-time guarantee. Governing context: [orientation](ORIENTATION.md)
and LLP 3000.030 §15, updated with this implementation.

## Before changing product code

`process-load.c` forks 3,000 idle children plus 36 CPU workers into its own
session/group. The parent holds that group number, requests group termination
on EOF/cancellation, and reaps its children. Every completed or cancelled load
cohort records all 3,036 children reaped. No unrelated process is signalled.
The host started around 2,460 processes; loaded measurements reach roughly
5,500–5,800, with additional native-build activity on this shared host.

`probe.py` extracts the **unchanged** original identity and membership functions
into a Rust timing executable. It also launches the real CLI's native supervisor
and measures EOF to exit with the caller's 20 ms polling cadence. The unit
cohorts execute the actual `PreparationProcess::cleanup()` through the original
NX tests. These are separate measurements: supervisor exit time is not a claim
to have instrumented the caller's complete preparation/export duration.

| Original code | members median / max | supervisor EOF-to-exit median / max | witness module |
| --- | --- | --- | --- |
| No synthetic load, 100 inspections / 5 runs | 28.157 / 34.849 ms | 120.102 / 120.131 ms | 4/5 parallel invocations pass |
| 3,000 idle + 36 CPU, 100 inspections / 10 runs | 63.256 / 85.237 ms | 183.242 / 194.028 ms | 5/10 parallel invocations pass |
| Same synthetic load, canonical serial mode, 5 runs | 61.916 / 90.556 ms | 173.415 / 196.552 ms | 5/5 pass |

The ticket's exact five-second watchdog error **did not reproduce** on the
unchanged mini code. Its worst observed supervisor exit retained **4.803 s** of
that deadline. This confirms the process-table/load dependence and measures the
margin; it does not prove the historical M5 failure's precise interleaving.
The parallel module failures are detailed below, not silently treated as passes.

The [paired measurement](paired-members.json) interleaves 100 original/candidate
inspections of the same owned one-member group while the synthetic load remains
active: original median **65.827 ms**, candidate **0.522 ms** (about **126×** less
time). The host had 5,796 processes and one-minute load 133.7 at collection.
This measures inspection, not overall export speed.

## Regression qualification

New regressions cover a buffer larger than the initial 32-PID capacity, member
births and exclusion of an outside group, invalid group IDs, observed progress
past the old fixed deadline, a stopped supervisor, deadline retention on retry,
late-group growth/shrinkage, and the hard cap despite continuous progress.
The completed real-deadline control took **8.123 s** with a five-second idle
budget under 5,793 processes/load 107; all 48 witness tests passed. A `PATH`
shim delayed every `ps` call by ten seconds and recorded calls: **zero calls**.
That is an additional absence control; no enumeration command remains to slow.

**Final loaded qualification: 50/50 module invocations, 2,400/2,400 tests pass,
zero failures/skips.** Each invocation uses `--test-threads=1`, as the
repository's canonical CLI-unit scheduler does; two independent invocations
run concurrently under one lane-owned 3,000-idle/36-CPU helper. No NX assertion,
test roster, timeout or skip was changed. The ordinary eight-second progress
regression runs in all fifty invocations: **8.074–8.306 s**, median **8.101 s**.
[Raw samples](final-load.json), [qualification/source hashes](loaded-qualification.json).

| Final loaded measure | n | minimum | median | p95 | maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct group inspection | 100 | 0.268 ms | 0.332 ms | 0.341 ms | 0.988 ms |
| Supervisor EOF-to-exit | 50 | 51.909 ms | 76.248 ms | 90.160 ms | 1,240.249 ms |
| Complete witness module | 50 | 28.336 s | 33.107 s | 35.731 s | 36.155 s |

The supervisor's scheduling outlier is retained. These cohorts include native
setup and workspace compilation; only the paired inspection experiment isolates
the enumeration change. Module durations also include the new eight-second
regression and are not a like-for-like test-suite speed claim.

Linux membership code is cross-compiled on this Mac with
`cargo check --target x86_64-unknown-linux-gnu` in an extracted-function harness.
There is no Linux execution claim and no remote host was contacted.

## Actual starter exports and full suite

The initial projects were freshly generated by the baseline CLI in `target/wd/`,
with npm-installed dependencies and local candidate client/native package trees
overlaid as NX did. Those 0.4.12 trees fail the existing exact dependency audit,
so their repeated exports rebuild and **are not warm timing evidence**. The
published 0.4.12 Expo package also fails its package-tree audit, independently
of local overlays; [follow-up ticket](../../../issues/20261003-snapback4-0.4.12-native-cache-audit-pins-stale.md).

For a valid cleanup comparison, `restore-audited.py` restores NX round 9's
SHA-256-verified starter source archives and exact 0.4.11 package tarballs into
this worktree's `target/wd/audited/`, then runs `npm ci` with its archived locks.
Both complete dependency hashes and the Expo package tree match the **unchanged**
current allowlist exactly: [verification](audited-starter-check.json). No other
worktree is read or modified, and no audit pin or cache check is changed.
These identical audited starter inputs are used with **both baseline and patched
0.4.12 CLI binaries**. This is a controlled cleanup comparison, not a claim that
fresh 0.4.12 package installs currently get the warm path. Production-profile baseline/candidate CLI binaries use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Node is explicitly pinned
to 24.18.0 for the qualified comparisons and canonical suite.

The audited starters run the actual `npm run export:ios`, with fresh JS edits per
sample (a harmless global marker survives bundling). The one lane-owned simulator is
`8D2EFE22-6E90-4ECE-9F7F-D504660838B4`, named
`sb4-wd-20261003-1791068684117-21819`; a private `XDG_STATE_HOME` also isolates
its creation records. `mini-verify-iphone` and all other sessions' simulators
and worktrees are untouched. Empty starters qualify native lifecycle and exact
export loading, not populated application scenarios or publication.

The canonical full suite **exited 1**, with the exact footer
`== 1 failure(s) in 2724 s`. All build/typecheck stages, Rust targets/doctests,
fixture wrappers (9/9), and client models (79/79) passed. CLI units passed
278 tests with four existing ignores; witness integration passed 76/76.
Ordinary clients reported **6,039 passed, one failed, five skipped, zero
cancelled**. This is **not a green full-suite qualification**.

The failure was `ENOTEMPTY` in the unchanged retained-history fixture's
`rmSync` after-hook (`MQ authoritative bound wasm`, line 196). Directory removal
is registered before client/server cleanup. All 68 cases ran (67 pass, one
teardown failure), but that case left its server alive, and Node buffered the
file's output while the remaining handle kept it alive. After more than sixteen
minutes, WD sampled its own Node/server, terminated that server, then terminated
the still-live Node child so the canonical suite could run its remaining stages.
The initial diagnosis of a first-case timeout was wrong; the flushed output
identified the actual fixture failure. No witness-preparation path is involved.
The unchanged file separately passed **68/68 in 56.248 s** with the candidate;
an isolated first-case original-CLI control passed too. Neither control erases
the failed/intervened suite attempt. [Follow-up](../../../issues/20260929-snapback4-acquisition-cleanup-enotempty.md#wd-recurrence-in-retained-history--2026-10-03),
[intervention record](retained-suite-stall.json).

The final comparison started after the load helper, native priming, isolated
control and canonical suite finished. **16/16 exports hit the native cache;
16 distinct exported bundle hashes matched their loaded bundle hashes;
48/48 native lifecycle segments passed.** One warm-up per starter/CLI is
excluded from the following three-sample distributions.

| Starter | Before total median (min–max), s | After total median (min–max), s | Before / after native median, s |
| --- | ---: | ---: | ---: |
| Plain | 24.968 (23.597–25.242) | 21.695 (21.318–22.940) | 20.500 / 18.348 |
| Social | 29.406 (29.091–32.158) | 27.877 (27.556–29.204) | 24.476 / 23.694 |

These are small sequential timing cohorts, not a causal estimate of total-export
speedup. One-minute host load at each start was 4.46–5.93 before and 4.59–5.43
after. The paired inspection measurement above isolates the enumeration change.
[Before samples](exports-before.json), [after samples](exports-after.json),
[summary and binary hashes](timing-summary.json),
[full-suite summary](full-suite-summary.json).

The owned simulator was shut down and deleted after the final export, under
its private lease; its private ownership records were removed. Both commands
returned zero and the exact UDID was verified absent. No other device was
changed: [cleanup receipt](simulator-cleanup.json).

## Development failures and limitations

- Original parallel units: one no-load invocation failed the smoke barrier's
  reacquisition of its file lock. Under load, five invocations failed; the
  observed failures are the unchanged heartbeat startup guard and the same
  inherited-lock boundary. Canonical serial mode passes 5/5. This lane neither
  edits these tests nor claims to fix unrelated fork-inherited lock semantics.
- The first candidate's shortened, **new** progress test used a one-second
  idle budget and failed once under contention. The campaign was cancelled
  after 24 completed module invocations (23 pass, one fail; one additional
  invocation was interrupted) and its helper reaped all 3,036 children.
  The regression now uses the actual five-second idle budget and waits eight
  seconds overall. Its original failure remains in the raw logs.
- A harness discovery error selected the normal CLI rather than the Rust test
  executable after a newer `cargo build`. Fifty immediate `unknown verb`
  refusals ran **zero tests** and are excluded from qualification. Discovery
  now validates the executable's `--list` output. The original result is
  retained in `harness-wrong-binary.json`.
- The first cold plain setup selected ambient Node 26.9.0. Its own recorded
  export wrapper was cancelled with TERM, returned 143, and recorded
  `E_WITNESS_INTERRUPTED`; it is excluded from the comparison. Subsequent
  exports pin Node 24.18.0. The interrupted receipt is retained.
- Native dependency downloads and other sessions' host work are uncontrolled.
  Host load is recorded per cohort/export; no quiet-host or social 25-second
  target claim is made from contaminated setup runs.
- Social's first cold setup spent most of its allowance downloading CocoaPods
  inputs, then compiling under load, and hit the existing 900-second preparation
  limit (913.772 s overall). It returned `E_WITNESS_BUILD`, completed cleanup,
  and did not report a watchdog-cleanup failure. The failed receipt stays in
  the setup cohort; the later comparison retries with those dependency/build
  caches available. No preparation deadline was raised.
- The initial 0.4.12 comparison completed three exports (plain 105.273 s,
  social 150.017 s, plain 101.795 s), all native-cache misses. On diagnosing
  the stale audit pins, the next social invocation was interrupted during
  Metro export. This setup series is excluded from warm results; its logs and
  three successful receipts remain in `exports-unaudited-js-setup.json`.
  The audited-input cold primes subsequently passed in 338.684 s (plain)
  and 334.608 s (social), overlapping the full suite and excluded from timings.

## Reproduction and evidence

From `snapback4/`, after frozen Bun installation and the ordinary binary/tests:

```sh
export PATH="$HOME/.volta/tools/image/node/24.18.0/bin:$PATH"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build -p snapback4
cargo test -p snapback4 --bin snapback4 --no-run
WD_PARALLEL_RUNS=2 python3 reports/20261003-wd-witness-cleanup-deadline/probe.py final-load 3000 36 50
```

`exports.py before` / `exports.py after` use the retained baseline/candidate
production binaries and local starter projects. The canonical command, from
the repository root, is:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh
```

Compact JSON, source helpers and this report are committed. Raw logs, native
receipts/apps, recordings and build products stay under this worktree's ignored
`snapback4/target/wd/`. The [evidence index](evidence-index.json) binds raw logs,
extracted measurement source, production binaries, receipts and current source.
Raw evidence is also copied outside the worktree to
`~/sb4-np/evidence-archive/20261003-wd-witness-cleanup-deadline/blobs/<sha256>`;
the export JSON indexes proof/recording blobs copied immediately after each run,
before normal artifact retention could replace them. `archive-evidence.py`
verifies existing blobs before reusing them. No newly added file over 256 KB,
`*.gz` or `*.mp4` is committed.
