# Snapback 4: live queries re-run on every `/changes` timeout and miss expiry

Status: Open
Priority: P2
Date: 2026-09-13
Systems: local/native observe, replica follow, expiry
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)

## Problem and reproduction

Three observation bugs stack:

1. `Replica.follow` always `syncOnce()` after `wait()`, including a long-poll that returned the same seq. An empty `more: false` page still sets `caughtUp` and notifies with `touched.size === 0`. Local `onChange` treats empty `touched` as “every watch”. That is a full interpreter pass (and restore+replay of the outbox) on every idle `/changes` timeout (default 25 s), and again on every real commit.

2. `waitForChange` `rerun`s matching watches **before** `syncOnce` applies the commit. `syncRound` sets `isCaughtUp = false` on entry, so that rerun can publish `fresh: false` with the old rows. The thread flashes “As of …” until apply notifies again. Online `createClient` does not do this.

3. Observed queries do not re-filter when the device clock crosses `expire at`. `evaluateLocal` hides expired rows **on a run**, but `observe` only reruns on replica/outbox/link events. An idle or offline screen keeps the pre-expiry snapshot until the sweep’s `del` arrives, or indefinitely if the client is open offline.

Every local/native `mutate` also invalidates every watch with no table filter.

## Implementation locations

- [snapback4/packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts) (`waitForChange`, `onChange`, `observe`)
- [snapback4/packages/snapback4/src/native.ts](../snapback4/packages/snapback4/src/native.ts)
- [snapback4/packages/snapback4/src/replica/replica.ts](../snapback4/packages/snapback4/src/replica/replica.ts) (`follow`, `syncRound`)

## Suggestion

Do not rerun on empty `touched`; flip `fresh`/`since` in place when only catch-up status changed. `waitForChange` should only wake `syncOnce`. Skip `syncOnce` when the poll did not advance seq/generation. When observed tables have `expire`, schedule a rerun at the next remaining expire time (capped).
