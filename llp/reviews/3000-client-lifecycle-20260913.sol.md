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
