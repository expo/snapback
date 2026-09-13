# Snapback 4: live queries re-run on every `/changes` timeout and miss expiry

Status: Resolved (2026-09-13)
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

- [snapback4/packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts) (`waitForChange`, `observe`)
- [snapback4/packages/snapback4/src/client.ts](../../snapback4/packages/snapback4/src/client.ts) (`poll`, `observe`)
- `snapback4/packages/snapback4/src/replica/replica.ts` (`follow`, `syncRound`; removed in 0.2.0)

## Suggestion

Do not rerun on empty `touched`; flip `fresh`/`since` in place when only catch-up status changed. `waitForChange` should only wake `syncOnce`. Skip `syncOnce` when the poll did not advance seq/generation. When observed tables have `expire`, schedule a rerun at the next remaining expire time (capped).

## Resolution

The unified local follower now distinguishes an idle `/changes` response from
an advancing sequence/generation. Idle polls continue polling without a sync
or query run; an advancing poll syncs first and only then reruns observations
whose tables the applied device page touched. An empty catch-up changes a
ready snapshot's freshness in place instead of running the interpreter.
Predictions likewise rerun only watches whose tables their device-reported
written rows touched.

Query outcomes now carry the earliest future expiry encountered by the visible
read. Both online and local observations schedule one capped timer at that
instant, replace it on rerun, and clear it when the observation or client
closes. Core `4b70bdb6f`, device `66651204e`, host `91c408ab7`, and client
`2ae63ec45` implement the path. Focused tests prove no idle apply/rerun, apply
before rerun, visible expiry while otherwise idle, timer disposal, and
table-scoped prediction invalidation.
