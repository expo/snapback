# EM round 10 — interrupted publication races maintenance export custody

2026-10-08; base `3a160628ca`. All work and verification stayed on eb1000 in
lane-em. No other worktree or process was modified. Nothing pushed or published.

## Finding and evidence limits

The next publisher can falsely refuse a completed export whose wrapper is
already dead: maintenance briefly holds the same `export.lock`, and interrupted
publication recovery previously made only one nonblocking acquisition attempt.
Two deterministic Linux regressions reproduce this with real maintenance
holders and the original recovery behavior, then pass with bounded retry.

The operator's six-run round-9 Mac soak passed policy 2/2, wakeup 22/22 and
diagnostics 5 passed/1 skipped. Five background runs passed 97/97; run 4 was
96/97. None had a maintenance drain timeout. Run 4 failed
`maintenance crash matrix: publication-committed (background, next Expo succeeds)`
at the next wrapper's status assertion after 11.174 seconds, with the missing
verified receipt and `interrupted publication still has wrapper custody` errors.

The supplied [exact archive](evidence/em-r9-mac-run4.tar.gz), SHA-256
`c75ce7dafde1125498cd21db144b4296e3c816228df5a23adbcba721b3203e12`, contains
the [run log](evidence/mac-background-4.log.gz) and four later cleanup snapshots.
The log names `snapshot-1791433322238689000-a7cd4b70-cleanup-cleanup` for the
failed fixture `sb4-background-6gxLP0`, but **that snapshot is absent** from the
archive. The retained snapshots belong to other fixtures. The
[input inventory](evidence/input.json) records this distinction. The existing
four-cleanup retention ring explains why a log path need not survive the run.
We cannot name the exact historical lease-holder PID from this archive, or
exclude an I/O failure that the old diagnostic incorrectly mapped to custody.

The old Node wrapper was PID 14796, from its owned run directory
`1791433320798-14796`. The test already executes `await wrapperExit` after
identity-checked SIGKILL of the publisher and before invoking the next export.
The wrapper's `finally` closes its export descriptor; its CLI shim waits for
the killed publisher before exiting. The test is not merely observing a stale
wrapper journal. No background proof custodian has launched at this checkpoint:
the committed callback/handoff comes later, and the matrix asserts that its
request and queue records do not exist yet.

## The ordering

1. The publisher commits the new namespace and verified receipt, then is killed
   at `publication-committed`, before clearing the interrupted-publication marker.
2. The shim and Node export wrapper exit, releasing their inherited export lease.
3. The next export runs its inventory maintenance backstop **before Expo**.
   It finds the interrupted transaction and starts the observer.
4. The observer may acquire the old export lease in `ready_run`; alternatively,
   its scan's retention worker acquires the lease before `reconcile_orphan`.
5. The next publisher obtains `publication.lock` and sees the pending transaction.
   Its old one-shot acquisition of the old run's `export.lock` fails. The error
   calls this "wrapper custody" without identifying an owner. The new receipt
   is never written, and the new wrapper returns status 1.

The two forced regressions pause those actual maintenance holders while the
publisher encounters their lease. The logs record both holder and publisher
birth identities, and assert the original wrapper has exited. Both original-code
controls fail at `1 !== 0` with the same missing-receipt/custody error family.
This establishes a product race, rather than a missing test-side wrapper wait.
Waiting once for the old wrapper/lease in the test would not stop the next
export's own maintenance backstop from reacquiring the lease afterward.

The sibling `next Expo fails` case never invokes a new publisher, so it cannot
hit this acquisition. `publication-handoff` has already cleared the destination
pending marker, so it bypasses interrupted-transaction recovery. Those differences
fit the operator's result. This race is platform independent: the portable
regressions use explicit smoke opt-out and real publication/maintenance on Linux.

[Historical source hashes](evidence/historical-source.json) show that
`recover_pending` is byte-identical in rounds 4, 7, 8 and 9. The round-9 fixture
priority change can alter the overlap, but did not introduce that one-shot code.
This does not prove which of the two reproduced holders caused the Mac incident.

## Policy and fix

The Node wrapper, Expo, CLI shim and native publisher are foreground descendants
of the runner; neither their launch nor the wrapper's `finally` uses taskpolicy.
Only the maintenance observer and proof custodian use the shared Darwin policy
selector. There is no separate background wrapper-cleanup process to exempt.
The round-9 fixture override and production background policy remain byte-for-byte
unchanged. No priority override extension is needed.

`recover_pending` now opens the old export lease once, retries **only WouldBlock**
at 20 ms intervals, and refuses after five seconds. It checks cancellation before
retrying. Other open/lock errors return immediately as artifact errors. Recovery
still requires the real kernel lease; it never trusts a dead PID as permission
to mutate or steal custody. The refusal now says `export custody`, not `wrapper
custody`. A timeout leaves the pending intent, committed generation and private
trees intact.

The publisher keeps its destination lock through this short handoff and the
existing verified-receipt/inode recovery. The reverse maintenance acquisition is
nonblocking: an observer drops its probe; a reconciler unable to obtain the
destination returns and drops its run/export leases. Thus no blocking lock cycle
is added. Once a pending transaction is reconciled, recursive old-tree deletion
still occurs outside the destination lock through the existing retention path.

Five seconds matches the existing bounded foreground initialization-lease wait;
it is a cap on exceptional interrupted-transaction custody, not a measured upper
bound for arbitrary Darwin I/O starvation. Sustained custody still refuses.
Normal publication with no pending intent has no retry wait. Scheduling and
publication never wait for a complete maintenance scan/drain. The previous blanket
LLP claims that publication never waits for any maintenance probe now explicitly
distinguish this interrupted-transaction handoff.

Debug-only barriers pause the observer probe, the reconciler before its
nonblocking destination acquisition, and the publisher after its first busy
acquisition. They use the existing one-shot, 20-second bounded barrier mechanism.
Release builds contain no pause behavior. No signal targeting or shared fixture
identity helper changes. The original crash matrix now captures an assertion
failure before cleanup into the existing bounded failure ring, then rethrows it.

## Regressions and controls

The same integration fixture kills the committed publisher through `signalFixture`,
reaps the wrapper, launches real maintenance and forces the next publisher to
encounter the selected lease holder before either is released:

| Case | Required result |
|---|---|
| Observer paused holding the old export lease | Release, then next export succeeds with a new generation and verified receipt |
| Retention worker paused before reconciliation's destination probe | Same success; old committed evidence survives |
| Observer kept paused through five-second acquisition cap | Next export refuses; exact old intent and generation survive; retry succeeds after release |

The [negative binary](evidence/negative-binary.json) was built before the retry
fix with only the [debug hooks](evidence/hooks-only.diff.gz) added to the original
product. Against the final two success regressions, both fail at the intended
status assertion; both fixtures recover and clean up afterward. The negative
CLI SHA-256 is `7e6ac1a98070ef29fe12f7790e0dea25c66b9a0b68dc3dfdd31d60a79cc1ca69`.
The expected exit is 1, retained in `negative-regressions.json`; initial development
controls are retained separately. Nothing was temporarily reverted in another
worktree.

The final CLI is pinned at SHA-256
`c1d3e15c9494de44769aaa9ba372ca3ce78e993694f2b1a8c55b7e504ddd473d`.
The native test executable and its sibling CLI are separately pinned in
[unit-binary.json](evidence/unit-binary.json). [Source hashes](evidence/source.json)
and [preservation checks](evidence/preservation.json) bind the tests and confirm
that priority selection, wrapper code, recovery worker, trace sink, native group
custody, `maintenanceIdle`/90-second guard and the 30-second post-driver wait
are unchanged.

## Verification on Linux

| Check | Result |
|---|---|
| Full export-background file, including original matrix and new regressions | 66 passed, 34 Darwin skips |
| Wakeup/sleep/deadline/publication suite | 22 passed |
| Bounded diagnostics | 6 passed |
| Export publication / failure / FL signal helpers | 6 / 2 / 9 passed |
| Shared runner, all six files | 111 passed, 34 skipped; no leaks |
| Separate complete crash matrix, including expired checkpoint control | 30 passed |
| Focused new custody regressions | 3 passed |
| Native retention / publication / clock / policy | 8 / 9 / 1 / 2 passed |
| Recovery, default parallel | 24 passed, 1 known failure |
| Same recovery binary, serial | 25 passed |
| Release cargo check | Passed |
| `../ref-check --root .. --verbose` | Passed; zero errors, zero unchecked |

The parallel recovery failure is the already-open
[fixture lease ticket](../../../issues/20261008-snapback4-parallel-recovery-fixture-leases.md):
`ownerless_shell_waits_only_for_live_leases_without_becoming_finished_evidence`,
`recovery.rs:683`, `retention lock busy`. That file is unchanged, and the failing
fixture has no pending publication, so it does not enter this round's retry path.
Prior rounds retained failures against baseline code too. Its cause is still
unconfirmed; the serial pass does not erase the parallel red.

Two execution setup errors are also retained: a focused command accidentally
repeated `node` and ran no tests; an initial publication unit run started before
the pinned sibling CLI was copied, yielding 8/9 with ENOENT. Correcting those
setups yields 3/3 and 9/9 respectively. Test failures and evidence were not edited
away. Raw logs/diffs that trip whitespace checks are stored losslessly as gzip
with hashes. The snapshot archive verifies **23 snapshots and 990 private files**
before removing only this report's unpacked copies. The full shared run took
391.955 s; the separate matrix took 153.566 s. Individual commands, statuses and
timings are in the accompanying JSON receipts.

## Governing context and follow-up

`llp-orient` scoped this change to LLP 3000.030 §15 (publication custody, atomic
namespace recovery, bounded maintenance and evidence) and LLP 3000's
`Publication suite under contention` (state barriers, identity-bound faults,
unchanged assertions). Both LLPs are in `llp/current/`, not the Snapback-1
foundation; Snapback 4's own workspace and append-only JOURNAL rules apply.
The changed LLP, ticket addenda and journal accompany the code. No new LLP or
public setting is introduced. Hand-off: none.

Both original maintenance tickets and the Mac retention incident remain open
for the operator's next soak. The reported round-9 soak supports the priority
fixture repair: no drain timeout in six runs. This separate publication fix
still needs Darwin qualification, and does not identify every historical timeout.

On the mini, from this revision's `snapback4/`, with Node 24 and a normal-priority
shell, build the debug CLI and rerun the existing pinned soak script:

```sh
bun install --frozen-lockfile
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=4 cargo build -p snapback4
python3 reports/20261008-em-export-maintenance-priority/mac-soak.py --out "$PWD/target/em-r10-mac" --runs 6
```

Use a fresh output directory. Expected: policy 2/2, wakeup 22/22, diagnostics
5/1 skipped, then **100/100** per background run (97 previous plus three custody
cases). The runner pins the built CLI, retains logs/snapshots and keeps the
production-policy probe separate. No Mac execution is claimed in this report.
