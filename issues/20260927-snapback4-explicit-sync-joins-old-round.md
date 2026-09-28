# Snapback 4: explicit sync can join a response captured before revocation

Status: Open
Date: 2026-09-27
Owner: Snapback 4 client sync lane

Lane SS round 3's one full suite fails
`native: legacy bare id cannot retain bytes after real home revoke` at
`packages/snapback4/test/asset-lists.test.mjs:237`: **real home is gone**.
After a server revocation, `await local.sync()` returns, the test goes
offline, and the old real-home row is still returned. The server asset GET
already denies access. The later local-asset denial assertion is not reached.

Classification: inherited scheduling failure, with a reproduced explanation
and an untraced full-suite schedule. Ten ordinary isolated repetitions pass
on each of the preserved merged-main release binary and the changed debug
binary. The original test, `local.ts` and native bridge are byte-identical to
main `09e55ad98`.

The controlled schedule in the report's patch fails the same assertion on
both binaries:

1. Finish the offline round, then fetch a sync response before revocation.
   Consume the response, but withhold it from the local client.
2. Complete the separate server `revokeAndTouch` mutation.
3. Call `local.sync()` and release the older response. `syncOnce` returns
   its existing `syncing` promise, so the new call joins that older round.
4. Make following sync requests unavailable and query offline. The old home
   survives the explicit sync. This simulates a legal delayed-response /
   connectivity schedule; it does not prove this exact schedule occurred in
   the full-suite run.

Reproduce the intermittent original case from `snapback4/` after building
the binary and package:

```sh
node --test --test-name-pattern='^native: legacy bare id cannot retain bytes after real home revoke$' packages/snapback4/test/asset-lists.test.mjs
```

For the controlled schedule, apply
`snapback4/reports/20260927-ss-sync-scale/round3-media-sync-control.patch`
with `git apply` at the root of a **disposable checkout**, then run that
command. The patch changes only fetch timing in that fixture. SS ran a
copied test under ignored target output, leaving the tracked test unchanged.
`SNAPBACK4_BIN` selects the baseline or current binary. The controlled test
is intentionally red; it is a reproducer, not a proposed product fix.

Decide the explicit-sync freshness contract and reconcile the test with it.
If an explicit sync after a completed server write promises a new observation,
do not satisfy it with an older captured response. Preserve coalescing for
background polls, acquisition publication, prediction fences and offline
recovery. Do not mask the stale-row assertion with retries without recording
what guarantee the API provides.

Evidence: [round-3 report](../snapback4/reports/20260927-ss-sync-scale/ROUND3.md),
[control logs and hashes](../snapback4/reports/20260927-ss-sync-scale/round3-failure-controls.json).
No production sync change or test assertion relaxation was made by SS.
