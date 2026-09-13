# Received client lifecycle review

Reviewer: Codex gpt-5.6-sol, xhigh, host lane; 2026-09-13.
Inspected: `50f933e80` against `cca6a2d0b`, JavaScript client/local/React/contract/mock and their tests. Native Rust excluded. Read-only review; the reviewer wrote none of these changes. The lead transcribes the received findings below; all four sequences were reproduced against the exact built delivery code.

- **P1 — adoption leaves old observations fresh.** A generation-one query observes table `a`; generation two changes it to table `b`. Successful adoption with an empty sync page never reruns the watch, while a page touching `b` also misses its old dependency set. The device advances but the old result stays fresh. All watches must rerun after successful adoption with usable new device state.
- **P1 — auth failure strands queued writes.** Two concurrent online mutations queue. A 401 settles the head and makes the client signed-out, so the flush loop exits with the never-sent tail still pending and no terminal `onWrite`. The dead session can never resume it. Never-sent tails need a terminal auth outcome.
- **P2 — an in-flight query recreates a closed observation's timer.** Close the watch before its response arrives; a response containing a future `nextExpiry` schedules a new timer even though the watch was removed. A dirty flag can also rerun it. Both tiers must verify watch identity after awaiting and before timer/rerun work.
- **P2 — failed session cleanup suppresses viewer notification.** Local invalidation clears the in-memory viewer but awaits `SessionStore.delete()` before listeners. A rejecting custom store prevents `onViewer`, leaving the hook stale. Notify the in-memory transition regardless of persistence cleanup.

Implementation was assigned to the separate client lane. Qualification and disposition follow in the journal.

## Follow-up review — 2026-09-13

Reviewer: Codex gpt-5.6-sol, xhigh, host lane.
Revision: `bfff6c24f` against `ff50eb1ae`.
Method: fresh read-only static review; no JavaScript build or test execution was claimed for this follow-up. The reviewer wrote none of the JavaScript changes.

Scope: `packages/snapback4/src/client.ts`, `local.ts`, `react.tsx`, `contract.ts`, `mock.ts`, and `packages/snapback4/test/client-lifecycle.test.mjs`. The revision changed only `client.ts`, `local.ts`, and the lifecycle test; the unchanged React, contract, and mock surfaces were inspected as lifecycle context. Native Rust cache edits were excluded.

Checks: traced pending-to-terminal mutation settlement through an authentication refusal, including the in-flight head and never-sent tail; traced raw and React observation ownership through unsubscribe, close, an in-flight response, dirty rerun, and expiry scheduling; traced session/viewer notification ordering when persistent session deletion rejects; traced generation adoption through device replacement, whole-watch invalidation, native-install failure, server fallback, and a later retry. The added focused regressions cover the four previously reproduced sequences.

**Verdict: NO MATERIAL FINDING.** The four reported lifecycle defects are addressed in the reviewed revision. No further change is requested from this review; qualification and author disposition remain separate.

## Received integration review — session rotation

A fresh independent Sol xhigh CLI reviewed the integration intersections at immutable `d8cdc6c81` and returned this material finding (static only):

- [P1] Stale-token `E_AUTH` permanently drops an in-flight write during session rotation. [`post()`](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/packages/snapback4/src/local.ts:380) snapshots the credential revision, but when `refusedSession` correctly ignores an `E_AUTH` from an obsolete revision, `post()` still returns that refusal as a successful transport result. [`flushOnce()`](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/packages/snapback4/src/local.ts:709) then treats non-retryable `E_AUTH` as terminal, calls `settle` without a sequence, emits a failed `onWrite`, and [`Device::settle(None)`](/Users/ccheever/projects/snapback-worktrees/sb4-36-delivery/snapback4/crates/snapback4-device/src/device.rs:596) deletes the durable outbox entry.

  Reproduction: start `/m/send` with bearer T0 and delay authentication; concurrently call `refreshSession()`, allowing `/auth/refresh` to rotate T0 to T1; then return 401/E_AUTH for the delayed T0 mutation. The refresh succeeds and `client.session()` remains T1, but the mutation resolves and emits `failed: E_AUTH`, its prediction is removed, and it is never retried under T1 despite never executing.

The other reviewed intersections matched the stated intent: partition current-image filtering and paged expiry authority, one-view Range/finalization, hidden collisions, durable GC reservation, capped aggregate continuation, native generation adoption/query expiry, checked-response writer poisoning, and host admission/auth/timeouts.

Static-only. The requested `--remerge-diff` was attempted, but Git could not create its temporary object directory under the enforced read-only filesystem; I used immutable combined-parent `git show --cc` and immutable resulting-blob views instead.

The separate client implementation lane is reproducing the obsolete-bearer mutation refusal and correcting its retry behavior while preserving the durable mutation ID and outbox entry. This received finding is not a clean integration verdict.

Correction: the regression reproduced the lost outbox entry before the patch. The transport now identifies an auth refusal ignored by session invalidation as obsolete, and write flushing retries before any settlement or terminal notification. The same ID is retried under the new bearer and settles once. Five session-security and ten focused lifecycle tests pass, plus typecheck/build. Final delta review follows.

## Final correction review — c30a517d7 — Sol

A fresh `gpt-5.6-sol` xhigh CLI session reviewed only the two final corrections statically and returned this received report. Its core correction scope had no material finding; the credential finding was reproduced and corrected below.

- **Material — obsolete mutation refusal can still settle a durable write.** At `c30a517d7cbb7429295a0708bee33b51b5534a94:snapback4/packages/snapback4/src/local.ts:388-392`, staleness is inferred from global `!sessionDead`, rather than the request’s captured credential revision. If another concurrent, current-credential request ends the session before the old mutation response completes (`:302-304`), the obsolete response gets `obsoleteAuth: false`. `flushOnce` consequently bypasses the retry guard at `:723-724`, settles/removes the queued ID at `:725-729`, and emits a terminal failed write at `:730-736`.

  Reproduction: start mutation M with token A; rotate successfully to token B; have a concurrent token-B request receive `E_AUTH`, ending the session; then release M’s delayed token-A `E_AUTH`. M is incorrectly settled as failed although its refusal came from the obsolete credential. This violates the correction’s durable-write guarantee.

Static-only bounded review covered both predecessor-scope/live-renewal behavior and credential-rotation write/read/watch handling. No material defect found in Correction 1.

### Disposition

Reproduced red with mutation A delayed until a current-token B query ends the session. Staleness is now captured from the request revision or active rotation before the refusal handler can change session state. The same regression retains the durable pending entry, while current-credential E_AUTH remains authoritative. Seven session-security and ten focused lifecycle tests, typecheck and build pass.

## Request-revision correction review — 0c21402ed — Sol

Received from a fresh `gpt-5.6-sol` xhigh session; only immutable supplied source and regression context was reviewed, without tools.

No material finding remains in the reviewed scope at 0c21402edaa23381d42d94edb915d73762ecaebe.

The pre-await classification correctly preserves stale status across successful rotation, failed rotation, and a concurrent authoritative session end. The mutation caller consequently retries without settling the durable entry, while a current-revision, non-rotating `E_AUTH` remains terminal through `refusedSession`.

This was a static-only review of the request-revision correction.
