# FL round 3 — complete publisher identities, no cached-PID fault signals

2026-10-07. Base `47b00027ac`; work and verification stayed on eb1000
(`expose-builder-pixel`), in this worktree. No push, remote execution, other
worktree changes or signals to another lane's processes.

## Review correction

Astra's P2 is correct. The two ownerless-publication cases waited for a file's
existence, then cached `Number(readFileSync(...))`. The C fixture opened that
file before printing its PID. An empty read became zero; waiting another 2.2
seconds did not refresh the cached value before `process.kill` used it.
The defect predates round 2, but **round 2's audit missed it**. Its affected
table row and blanket conclusion are now explicitly corrected.

The review inputs were `~/sb4-intent/reviews/fl-r2.astra.md`, its evidence
`REVIEW.md` and safe reproduction, and `fl-r2.grok.md`. Astra's verdict was
READY WITH CHANGES; Grok's was READY. Neither is a review verdict for this
new revision. Both preserved the earlier cleanup-order/assertion findings.

## Implementation

`publication-interposer.c` now writes the complete decimal PID and newline to
a `mkstemp` file in the barrier directory, checks printing and close, then
renames it to the final path. Failure exits the fixture instead of advertising
readiness. A reader cannot observe the final inode with an incomplete payload.

The new test-only `helpers/publication-barrier.mjs`:

- Waits, bounded at 30 seconds, for a strictly decimal positive PID within
  `pid_t` range. Empty, zero, negative, fractional, exponent, oversized and
  partially written records cannot satisfy readiness.
- Requires a live process with the exact expected command, including this
  fixture's private source/destination and `--environment-skip` for the
  ownerless cases. Linux reads argv from `/proc`; Darwin uses bounded `ps`.
  The existing process-inspection helper supplies birth identity, checked on
  both sides of command inspection.
- Rechecks that command and the captured birth immediately before a normal
  fault request. A stale, exited or wrong-command identity refuses the request.

Validation alone cannot eliminate exit/PID-reuse between an inspection and a
numeric kill. Consequently **these publisher tests no longer send SIGKILL to a
PID read from disk**. The private `.kill` file asks the injected, paused C
publisher to `raise(SIGKILL)` on itself. If it has exited, the request cannot
signal a replacement process. The actual process still dies with SIGKILL at
the same before/after exchange boundary, without executing Rust cleanup.

Teardown may release that private barrier even when no usable PID record was
obtained. This authorizes only the injected child at this fixture's unique path
to terminate itself; it never converts missing metadata to a process/group
number. Wrapper exit and the ordinary fixture cleanup remain awaited.

The related `export-publication` custody test also cached a publisher PID for
its final cleanup. Its stdout handshake already occurred after the complete
write, so it lacked the empty-read race. However, that numeric cleanup kill
could outlive the publisher. Its record is now atomically published and
validated; teardown releases the publication lock and waits for that birth
identity to exit, without signalling its cached PID. All lease, publication,
finished-state and byte assertions remain.

No product source, product timeout, publication outcome or invariant changes.
The strict `dev_refusals` source, blocked-retention cases, compression fixture,
shared cleanup, and round-2 simulator-death cases remain byte-identical:
[preservation evidence](evidence/preservation.json).

## Signal-pattern audit

The search covered all of `export-background.test.mjs`, the other export files
sharing its C fixture, both C interposers, `test/helpers/`, and the shared
`scripts/test-*.mjs` infrastructure. [Search record](evidence/signal-audit.txt).
This extends/corrects the round-2 observation audit; it is not a claim that
all pre-existing numeric signalling has a kernel handle immune to PID reuse.

| Sites | Finding / action |
| --- | --- |
| Ownerless publication before/after exchange | Empty scalar record could become PID 0. Fixed atomic publication, complete positive parsing, command/birth validation and self-directed fault. Both immediate boundary invariants and final repair assertions remain. |
| Publication inherits custody after wrapper death | PID write preceded stdout readiness, but cached PID was later used for cleanup. Removed that kill; atomic identity record and release-then-exit wait added. |
| Background driver/worker death, blocked custody, paused owner watcher, skipped-maintenance death, sole maintenance peer death | Numeric targets come from parsed product role/launch records, with producer readiness established by the blocked owned fixture. Product role records are renamed into place and contain positive process IDs. There is no empty-text-to-number conversion. These existing custody cases are unchanged. |
| Maintenance crash matrices, empty legacy claim and handoff matrices | The debug checkpoint can be created before its write completes, but callers poll `read(...)` for parsed JSON. Partial data cannot yield the checkpoint PID. Other peer records are complete product JSON. No new numeric signalling introduced. |
| `holdRetention`, initialization/publication lock helpers and runtime-list events | Empty marker files announce a previously acquired lock, not a PID to parse. Runtime events are parsed JSON, while the shared fixture is held. Directly spawned children are handled through their `ChildProcess` handles. |
| `retention-interposer.c` | Its scalar `pause-owner-pid` only selects whether the current process pauses: it compares to `getpid()`. It never signals the parsed number. An incomplete value cannot select PID 0 as a signal target. |
| `scripts/test-processes.mjs` | `identity()` validates PID inputs; `/proc`/`ps` metadata supplies birth information. Its numeric signal-0 calls only inspect existence. Command timeouts signal directly owned child handles. No PID-file signalling protocol. |
| `scripts/test-file-owner.mjs`, blocked-compressor escape hatch | Deliberate `kill(0, SIGKILL)` is executed inside the already-owned keeper/compressor group itself. It is not derived from a file or supplied by the test parent. Round-0 custody and timeout cleanup are preserved. |
| `test/helpers/` process helpers | App/server/fixture cleanup uses retained child handles. `live-margin-load.mjs` derives its owned group IDs from direct spawns; no file read supplies them. `publication-roundtrip-mock.mjs` replaces signalling with an assertion/recording mock. Other hits are comments or metadata, not file-to-signal operations. |

The governing context remains LLP 3000#publication-suite-under-contention
(complete readiness while preserving invariant assertions) and LLP 3000.030#15
(publication ownership, leases and birth identities). No product design or LLP
contract changed. The existing process-inspection helper is reused unchanged.

## Regressions and verification

Two permanent tests in `export-publication.test.mjs` compile the **actual shared
C fixture** with a test-only `fprintf` barrier, for both before/after phases.
They pause it between opening its PID output and writing any bytes, and require
the final pathname to be absent. After release, they require the published PID
to equal their actual child, and inspect its command/birth. Invalid PIDs, wrong
command, changed birth and an exited process must all reject **without creating
the fault-request file**. The positive control must exit via SIGKILL. For an
exited PID, either disappearance or replacement is a valid refusal; neither may
create a request. Cleanup uses the actual child handle, never the parsed PID.

- **20/20 loaded regression runs:** both barrier cases pass each round, **40
  positive test passes**, with all embedded invalid/stale controls rejecting.
  Four directly owned busy loops plus tests/children share CPUs 80–81 with
  `taskset`. Sources unchanged across the final load run; load children reaped.
  [Summary](evidence/loaded-summary.json), [output](evidence/loaded-barriers.log).
- **Old-fixture negative control:** a private C copy restores create-before-write;
  both unchanged regressions fail specifically at `incomplete PID record must
  not be published`. No PID 0 signal is attempted; runner reports no leak.
  [Harness](reproduce/barrier-negative.mjs), [log](evidence/barrier-negative.log),
  [result](evidence/barrier-negative-summary.json).
- **Five export suites:** **82 passed, 33 existing platform skips**, no failures,
  cancellations or runner-reported leaks. Background: **62 passed / 32 Darwin
  skips**, including both ownerless-publication cases. The file still declares
  94 cases. Publication now has six cases, including the two new regressions.
  [Suite log](evidence/export-suites.log). After making the exited-record control
  accept either safe refusal path, the final publication file also passed 6/6
  under the canonical runner: [final log](evidence/publication-final.log).
- **Read controls rerun:** all **42** Astra corruptions reject the first pair,
  including all 21 combined with sequence advance. A lone sequence advance
  passes both trace modes; endless advancement fails at eight pairs. Removing
  the strict guard makes the permanent regression fail as required. Scripts
  restore/rebuild the original test in `finally`; final `dev_refusals` passes
  **22/22**. [Corruption summary](evidence/retry-masking-summary.json),
  [retry summary](evidence/retry-controls-summary.json), [suite](evidence/dev-refusals.log).
- **Round-0 custody controls rerun:** the existing private disabled-drain binary
  causes the intended custody failure; the deliberate 10-second timeout also
  fails. Both reap fixture groups, remove their roots and report no runner leak.
  [Custody log](evidence/custody-negative.log), [timeout log](evidence/timeout-control.log).
- **Round-2 recovery replay rerun:** both positives pass; retained ownership,
  wrong marker identity, late unrelated call and changed bytes still reject.
  [Results](evidence/simulator-cleanup.json).
- Syntax checks and `git diff --check` pass. No new test file/inventory entry;
  the regressions extend the existing publication file.

Retained development logs include the initial exact-command refusal (the
expected argv initially omitted the real `--environment-skip` flag) and the
negative-runner harness initially reading `tests` instead of `counts`. Both
were corrected; neither was passed off as final verification or relaxed a
product assertion. Text logs normalize trailing whitespace and omit trailing empty lines.

Darwin execution, full publication qualification and a new review verdict are
not claimed. The user's mini soak remains the runtime check for the Darwin
command inspection and the existing Darwin-only paths.

## Reproduce

From `snapback4/`, with its debug binary and the round-0 private disabled-drain
binary already built:

```sh
python3 reports/20261007-fl-dry-run-flakes/round-3/reproduce/load.py
node reports/20261007-fl-dry-run-flakes/round-3/reproduce/barrier-negative.mjs
python3 reports/20261007-fl-dry-run-flakes/round-3/reproduce/retry-masking.py
python3 reports/20261007-fl-dry-run-flakes/round-3/reproduce/retry-controls.py
node reports/20261007-fl-dry-run-flakes/round-3/reproduce/custody-negative.mjs
node reports/20261007-fl-dry-run-flakes/round-3/reproduce/timeout-control.mjs
node reports/20261007-fl-dry-run-flakes/round-2/reproduce/simulator-cleanup.mjs
node scripts/run-client-tests.mjs 2 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs
```

Run the two Rust mutation controls sequentially. Their changes from round 1
are evidence paths only. The custody control copies additionally resolve the
new test-only helper import when relocating the test file. No control modifies
product source, another worktree or another lane's processes.
