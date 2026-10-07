# FL round 6 — compiler group custody

2026-10-07. Base `c8c6d49420`, branch `sb4-intent/fl-dry-run-flakes`.
Work and verification stayed in this worktree on eb1000 (`expose-builder-pixel`).
Nothing pushed; no other worktree or other lane's processes changed.

## Finding and correction

Astra's round-5 review (`~/sb4-intent/reviews/fl-r5.astra.md` and
`fl-r5.astra.evidence/REVIEW.md`) reproduced a live GCC frontend after the
driver timeout. The driver handle was reaped, but destroying its capture
pipes allowed the caller to finish while `cc1` survived under PID 1. Its
31.1-second result is preserved in [the review evidence](evidence/review-real-compiler-descendant.log).
Grok's review was pending in the request; no new independent verdict is claimed.

`runOwnedCommand` now starts a Node keeper in a private process group. The
keeper starts the compiler without detaching it, so ordinary frontends,
assemblers and linkers inherit that group. On timeout or output overflow, the
caller requests TERM over its owned stdin pipe. The living keeper signals its
own group, retains its one-second grace timer even if the driver exits, then
sends KILL to that group. A normally completed command also releases its group.
EOF or IPC disconnect after caller death triggers the same TERM/KILL cleanup.
The parent does not send a signal to a cached PGID.

Before reporting completed cleanup, the helper reaps the keeper and requires
two complete process-table observations, 50 ms apart, with no living group
member. Zombies count as exited, as in the file runner. Inspection happens
after keeper **exit**, before waiting for pipe **close**: a living descendant
holding an inherited pipe cannot prevent the bounded cleanup inspection.
Persistent live members or invalid routing refuse after the 60-second
observation window; failed/truncated listings refuse immediately. Failed
inspection is returned as an explicit `cleanupError`, not an empty-group
claim. Output close also has a ten-second bound before pipes are destroyed.

Bootstrap observation uses `/bin/ps` directly with bounded asynchronous capture.
It cannot import the normal identity API because it is verifying compilation
of that API's Darwin inspector. The system ps is a leaf command and uses its
retained child handle on timeout. The existing file runner's keeper protocol
and process-table parser are unchanged. No compiler or inspector is needed
for a keeper to signal its own group.

This follows LLP 3000#publication-suite-under-contention's keeper custody and
LLP 3000.030 §15's ownership model. The llp-orient context remains scoped to
those provisions and Snapback 4's AGENTS/NOT-DOING/JOURNAL fence. LLP 3000 now
records the compiler-group extension. All source files remain below 1,500 lines.

## What signalling does and does not guarantee

- **Owned command groups:** a live keeper signals the private group it belongs
  to. The caller requests cleanup over its pipe and only observes the group's
  numeric ID afterward. Ordinary descendants are covered; deliberate group
  escape is outside this custody. Unexpected keeper death or unproved drain
  is an error, not permission to signal a cached group number.
- **Owned direct children:** `signalChild` retains the command/birth checks,
  then dispatches through the registered native ChildProcess handle. It no
  longer converts that owned child into a numeric `process.kill` call. The
  regression now separately intercepts numeric and handle dispatch and checks
  the correct route. If the native handle closes after inspection, its false
  return refuses the fault; it does not count as successful injection or fall
  back to a PID. Borrowed and imitation handles still refuse.
- **Recorded-PID faults:** command and exact birth are rechecked immediately
  before every numeric signal, with no await or caller callback between the
  final inspection and dispatch. This is not atomic with the kernel syscall.
  A target can exit and its PID can be reused in that small interval, potentially
  redirecting the signal. There is **no absolute guarantee** that an unowned
  PID can never be signalled by this path. Group or handle custody is preferred
  wherever the test owns the process.

These distinctions are explicit in source comments and the new JOURNAL entry;
the round-5 report now corrects its compiler cleanup scope and links this
qualification. [Signal-site audit](evidence/signal-audit.txt).

## Regressions and verification

The new subprocess tests invoke the command helper before creating any file
keeper inside that subprocess, matching inspector startup. Their compiler
stand-in forks a frontend that holds its inherited pipes and ignores TERM.
One driver ignores TERM; the other exits on TERM. Both tests observe group
TERM at both processes, require both processes gone **before the subprocess
returns**, independently inspect the returned group, and reject emergency
fixture self-release as success. Five additional cases require two empty
snapshots and refusal of empty, failed, truncated or malformed inspection.

Restoring round 5's leaf-only implementation makes both subprocess cases fail
at the live-frontend assertion. Their private release markers clean up after
the assertions; neither a fixture teardown nor the file keeper supplies the
passing oracle. [Control log](evidence/group-negative.log),
[summary](evidence/group-negative-summary.json).

The real-driver reproduction uses the host's `/usr/bin/cc` with `-B` to supply
a deliberately stalled `cc1`, through the actual mocked-Darwin initialization
path. It returns `cc ETIMEDOUT` after **31.2 seconds**, observes TERM in the
frontend, and finds that frontend **gone** when the runner returns. There is
no detached frontend or group escape. [Real GCC result](evidence/real-compiler.log).

- **Nine export/helper/runner files: 193 passed, 33 platform skips**, no failures
  or runner leaks. Background is **63 passed / 32 Darwin skips**.
  [Complete suite log](evidence/suites.log).
  These include the new group cases, both old direct-child hang regressions,
  all five export files, shared process inspection and the file runner.
- **Surrounding helper consumers:** app-online, asset-avatars, read-through
  and timeline-delivery pass **49/49**. [Adjacent suite](evidence/adjacent.log).
- **`dev_refusals`: 22/22**, after restoration from the mutation controls.
  The strict point-read comparison and fresh stderr-recovery sentinel are
  byte-identical to round 5. [Final Rust log](evidence/dev-final.log).
- **20 loaded repetitions: 40 subprocess passes**, no failures.
  [Summary](evidence/loaded-summary.json) and
  [full log](evidence/loaded-groups.log). Four owned busy loops and both new
  compiler subprocess cases share CPUs 80–81. The source hashes are checked
  across the run; the loops exit through owned pipes and are reaped.
- **All earlier controls:** all 42 read corruptions reject on the first pair,
  including sequence drift; lone drift passes and unbounded drift fails at
  eight pairs; removing the strict comparison fails the permanent regression.
  [Read matrix](evidence/retry-masking-summary.json),
  [retry controls](evidence/retry-controls-summary.json). The three stderr
  controls retain their outcomes. [Stderr results](evidence/stderr-controls-summary.json).
- **Earlier process/publication controls:** interpreter refusal, abandoned
  direct-child cleanup and absent compiler escalation still fail their
  regressions with independent cleanup. The compiler-escalation control
  deliberately restores the original leaf helper and removes its KILL timer;
  the separate new group control tests descendant custody.
  [Hang controls](evidence/timeouts-negative-summary.json). Removed recorded-PID
  dispatch checks and non-atomic publication still fail safely with intercepted
  calls/private release. [Signals](evidence/signals-negative.log),
  [barrier](evidence/barrier-negative.log). Disabled custody and forced timeout
  still fail and reap their fixture processes. [Custody](evidence/custody-negative.log),
  [timeout](evidence/timeout-control.log). Simulator replay remains two positives
  and four expected refusals. [Simulator](evidence/simulator-cleanup.json).

[Preservation evidence](evidence/preservation.json) confirms unchanged product
source, `dev_refusals`, background/failure test files, publication barriers and
interposer. Existing assertion strength is retained. Only the owned-child
dispatch assertions change their interception route, adding the requirement
that the retained handle is used.

This is Linux execution evidence. The Darwin JavaScript bootstrap path is
exercised with a fake compiler and real GCC on Linux; native Darwin compilation
and the Darwin-only witness cases still require the user's Mac soak. No
publication qualification is claimed. The reference checker still reports
the existing missing LLP 3000.035 anchor in untouched difftest code.
[Reference-check output](evidence/ref-check.log).

One reproduction-harness adaptation initially stopped before executing any
test: it assumed only one `checkSignalRecord` call, whereas direct children
now check before handle dispatch too. The corrected mutation selects only
the recorded-PID check immediately before `process.kill`. The initial guard
failure is retained in `signals-negative-harness-error.log`; it is not a
negative-control result. All requested suites pass on the final code.
An initial full suite and 20 loaded group rounds also passed before adding the
explicit closed-handle fault refusal. Those logs are kept under
`before-closed-handle-check-*`; the final suite and loaded results are separate.

## Reproduce

From `snapback4/` with the normal local binary/client artifacts and Node 24:

```sh
node scripts/run-client-tests.mjs 3 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs packages/snapback4/test/test-signals.test.mjs packages/snapback4/test/test-command-group.test.mjs packages/snapback4/test/test-processes.test.mjs packages/snapback4/test/test-file-runner.test.mjs
node reports/20261007-fl-dry-run-flakes/round-6/reproduce/group-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-6/reproduce/real-compiler.mjs
python3 reports/20261007-fl-dry-run-flakes/round-6/reproduce/load.py
```

The other controls under `round-6/reproduce/` have the same invocation forms
as round 5. Run the three Rust mutation scripts sequentially; each restores
and rebuilds in `finally`. The disabled-custody control uses the lane's existing
private round-0 mutant under `target/fl-negative`.
