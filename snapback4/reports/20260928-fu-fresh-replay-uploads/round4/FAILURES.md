# Round 4 failure ledger

All observed reds in this round are **ours**, including test-development errors and intentional negative controls. No baseline or environmental test failure was observed. The last combined run was 595 pass / 1 fixture failure; both corrected diagnostic-persistence cases pass the final focused rerun. Earlier partial runs are not relabeled green.

## adjacent-initial.log.gz

**Ours.** The online start introduced an await before establishing its refresh barrier (product regression, repaired). The other two failures were fixtures targeting the old number/order of store operations; they now target successor persistence and assert the retained predecessor claim.

- `a failed local rotation save is not silently repeated by its notification`
- `online session: near-expiry rotates before a protected read; concurrent refreshes coalesce`
- `the default session store stays in memory and browser persistence is explicit`

## app-expanded-initial.log.gz

**Ours.** Older custody fixtures expected a competing refresh to dispatch, awaited successor adoption while holding the same storage lock, or damaged the store before a claim could be written. Reworked the interleavings without weakening credential/epoch preservation. The native fixture used keepSession from inside a locked get and deadlocked; its explicitly out-of-protocol writer now writes the backing adapter directly.

- `a stale online refresh preserves another owner's kept successor`
- `a stale local refresh preserves another owner's kept successor`
- `stale online restoration restarts when another app rotates before its first save`
- `stale local restoration restarts when another app rotates before its first save`
- `restoration cleanup of invalid JSON preserves a replacement written after its read`
- `restoration cleanup of expired session preserves a replacement written after its read`
- `snapback4/packages/snapback4/test/app.test.mjs`

## custody-initial.log.gz

**Ours.** The changes fixture incorrectly combined public sync with owner-only read rules; corrected to the existing owner-scoped schema.

- `online: nonretryable changes (false) is visible and stops polling`
- `web: nonretryable changes (false) is visible and stops polling`
- `online: nonretryable changes (undefined) is visible and stops polling`
- `web: nonretryable changes (undefined) is visible and stops polling`

## discard-probe-headers-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `public web probe recovery paces retryable and respects Retry-After`
- `public web probe recovery paces nonretryable and respects Retry-After`
- `public web probe recovery paces malformed and respects Retry-After`

## fence-unsent-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `app-online: a proven unsent automatic refresh can renew later (explicit)`
- `app-online: a proven unsent automatic refresh can renew later (scheduled)`
- `app-online: a proven unsent automatic refresh can renew later (peer)`
- `app-web: a proven unsent automatic refresh can renew later (explicit)`
- `app-web: a proven unsent automatic refresh can renew later (scheduled)`
- `app-web: a proven unsent automatic refresh can renew later (peer)`
- `local: a proven unsent automatic refresh can renew later (explicit)`
- `local: a proven unsent automatic refresh can renew later (scheduled)`
- `local: a proven unsent automatic refresh can renew later (peer)`

## hide-changes-refusal-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `online: nonretryable changes (false) is visible and stops polling`
- `web: nonretryable changes (false) is visible and stops polling`
- `online: nonretryable changes (undefined) is visible and stops polling`
- `web: nonretryable changes (undefined) is visible and stops polling`

## malformed-auth-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `app-online: a shared-store peer and a new runtime fence json refresh`
- `app-web: a shared-store peer and a new runtime fence json refresh`
- `local: a shared-store peer and a new runtime fence json refresh`

## no-durable-claim-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `app-online: a shared-store peer and a new runtime fence reset refresh`
- `app-web: a shared-store peer and a new runtime fence reset refresh`
- `local: a shared-store peer and a new runtime fence reset refresh`

## polls-fixed.log.gz

**Ours.** The observation fixture called peek() instead of the public getSnapshot(); corrected.

- `online: nonretryable changes (false) is visible and stops polling`
- `web: nonretryable changes (false) is visible and stops polling`
- `online: nonretryable changes (undefined) is visible and stops polling`
- `web: nonretryable changes (undefined) is visible and stops polling`

## polls-initial.log.gz

**Ours.** The changes fixture used an invalid public-sync/owner-read schema; corrected.

- `online: nonretryable changes (false) is visible and stops polling`
- `web: nonretryable changes (false) is visible and stops polling`
- `online: nonretryable changes (undefined) is visible and stops polling`
- `web: nonretryable changes (undefined) is visible and stops polling`

## public-expanded-initial.log.gz

**Ours.** The online warning assertion ran before its asynchronous automatic refresh finished. Wait for auth.why; the separate far-expiry restoration test still requires warning before an explicit refresh.

- `app-online: a shared-store peer and a new runtime fence reset refresh`
- `app-online: a shared-store peer and a new runtime fence json refresh`
- `app-online: a shared-store peer and a new runtime fence body refresh`

## session-model-claims.log.gz

**Ours.** The I2 claim exception initially missed revokeCurrent, which also invokes refresh. Covered explicitly; I14 additionally refuses any repeated consumed bearer.

- `online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`
- `local session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`

## session-model-initial.log.gz

**Ours.** I2 still prohibited the required pre-dispatch claim. The model now allows only that metadata change while preserving credentials and epoch.

- `online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`
- `local session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences`
- `model regression: failed local rotation persistence cannot be committed by a second notification save`
- `model regression: offline reopening starts after close commits the owned rotation`
- `model regression: refusal after a failed rotation save also excludes its consumed predecessor`
- `model regression: replacement retires a rotation whose persistence read failed`
- `session model sweeps 120 failure points after an unpersisted rotation`

## spin-nonretryable-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; the corresponding fixed public tests pass.

- `public web probe recovery paces nonretryable and respects Retry-After`

## affected-qualified.log.gz

**Ours.** One diagnostic-persistence fixture expected the original in-memory transport error on a later explicit call. That call correctly consults the durable generic unknown claim after its detailed save failed. Corrected to assert original automatic warning separately; final two-tier rerun passes.

- `app-web: failed outcome persistence retains the pre-dispatch fence and warning`

## cache-peer-claim-negative.log.gz

**Ours — expected negative control.** Expected regression-negative control in a disposable SDK copy; corresponding fixed public tests pass.

- `app-online: a peer releases its warning after the owner proves non-dispatch (explicit)`
- `app-online: a peer releases its warning after the owner proves non-dispatch (scheduled)`
- `app-web: a peer releases its warning after the owner proves non-dispatch (explicit)`
- `app-web: a peer releases its warning after the owner proves non-dispatch (scheduled)`
- `local: a peer releases its warning after the owner proves non-dispatch (explicit)`
- `local: a peer releases its warning after the owner proves non-dispatch (scheduled)`
## Interrupted run and tool/setup errors

- **Ours:** the first expanded app run was stopped during `native smoke observes only the published replacement of a near-expiry restored session`: the fixture reentered the session lock via `keepSession`. The preceding six failed/timed-out tests are listed above. No complete count is claimed for that interrupted run; recorded PIDs are in `interrupted-app-pids.json`. The repaired complete app file passes 78/78.
- **Ours:** a one-off Python edit loop tried to remove blank lines from an already full source file and made no progress. Stopped its recorded PID 1363551; no source write from that loop. Replaced it with a bounded patch and a shorter module comment. `local.ts` remains at 1,499 lines.
- **Ours:** one multi-file apply_patch did not match a test variable named `op` (the patch expected `kind`); it applied no changes and was replaced with the exact edit.
- **Ours:** exploratory reads named nonexistent `session-store.ts`, `app-session.ts`, `transport.ts`, `reference/*.md`, and guessed helper/LLP paths; repository searches located the real files. These were read/setup failures, not product or environment failures.
- **Expected controls:** seven mutations remove durable claiming, non-dispatch recognition, malformed-success handling, nonretryable-probe pacing, probe Retry-After headers, or terminal changes-refusal handling. The final control set fails 29 named public cases; earlier control runs exercised subsets, retained in the run logs. No control modified working source or the qualified package dist.
- No `scripts/test.sh` invocation in this round. No push, publication, tool installation, or change to another lane.
