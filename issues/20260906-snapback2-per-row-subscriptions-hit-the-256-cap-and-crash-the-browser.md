# snapback2: one `useQuery` per rendered row walks into the 256-subscription cap and crashes the browser; live-update misses forced polling

**Date:** 2026-09-06 · **Area:** snapback2 React arm / live queries · **Source:** Clique full run, grok-snapback2 (M3, M4 diary, essay) and astra-snapback2 (M8 diary, essay)

## What happened

- grok: a `useQuery` per message bubble for receipts and reactions multiplied toward the
  256-subscription cap and **crashed Chromium**; the builder collapsed receipts to the last
  outbound message. "Convex's `useQuery` is cheap enough that people do this without thinking."
- astra: rewrote chat delivery so it "avoids mounting a subscription per membership", and after
  "intermittent live-update misses" added a one-second authoritative reconciliation query to every
  active chat surface. The builder flagged that read cost as "a compromise, not a free property of
  the platform".
- grok's verdict: "Live queries under many subscriptions are fragile compared to Convex's
  per-query tracker."

Two separate problems: the hook has no dedupe or batching for identical query shapes, and the
failure mode at the cap is a crash rather than a diagnostic; and live updates were observed to be
missed under load (machine load 45–112 during these runs; possibly the same family as
`20260905-snapback2-real-owner-revocation-until-window-flakes-under-load.md`).

## Proposed

1. Dedupe identical query subscriptions inside the React arm and share one wire subscription
   across hooks; count distinct shapes, not hook instances, against the cap.
2. At the cap, refuse the newest subscription with a stable diagnostic and a guide pointer; never
   let the page die.
3. Guide page on subscription budgeting for list surfaces (one query per surface, rows carry
   their receipts and reactions).
4. Reproduce the live-update miss: a chat surface under sustained writes with a second client,
   assert no update is lost without polling. If it reproduces only under machine load, say so and
   record the threshold.

## Remaining scope — reconciled 2026-09-08

Shared-query deduplication, composite-screen guidance (`guide/live-query.md`) and a named `E_OWNER_BUSY` refusal above 256 subscriptions are implemented. The actual owner witness covers 60 queries plus a channel; shared-consumer browser lifecycle is also witnessed. Retain this ticket for an executed 256/257 boundary control and the original sustained-write/no-polling crash reproduction, including any reproducible load threshold. Those narrower witnesses do not establish the full capacity claim.

Read-only source and recorded-execution audit against main `2ac15dc2c`; no new test execution or publication is claimed by this update.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open. Current real-Chromium `witness-web
--sessions` passed on `15c134d056`: two consumers shared one stream, closing
one preserved the other, and follower sends crossed the one writer in FIFO
order. That is a shared-consumer control, but exercises far fewer than 256
distinct shapes and no sustained second-client writes. Wrapper PID 3273399;
real browser, IndexedDB and Web Locks. Closure still needs the 256/257 boundary
and a no-polling sustained-write run, with load threshold if dependent.
