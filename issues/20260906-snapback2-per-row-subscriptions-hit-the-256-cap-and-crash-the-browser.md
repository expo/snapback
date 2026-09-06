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
