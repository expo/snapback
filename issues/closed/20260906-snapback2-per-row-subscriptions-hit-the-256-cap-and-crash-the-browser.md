# snapback2: one `useQuery` per rendered row walks into the 256-subscription cap and crashes the browser; live-update misses forced polling

**Status:** Closed — exact browser boundary and no-poll delivery qualified (2026-09-11)
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

## Resolution — 2026-09-11

Commit `85b8d3821` closes the remaining failure mode and witness gap. The shared
client now refuses only logical child 257 locally with `E_OWNER_BUSY`,
`site: client.subscribe`, and `guide: live-query`; it does not turn the owner's
capacity response into a terminal failure for the 256 healthy siblings. Closing
one child immediately permits a replacement. The live-query guide states the
distinct-shape budget and the list/composite-query alternative to per-row hooks
or polling.

The deterministic multiplex regression passed 9/9 channel tests and proves an
initial batch of 256, an isolated refusal at 257 without another owner control,
and remove-plus-replacement on the same stream. The scheduled real-browser
entry point now has a focused `witness-web --capacity` mode.

That witness passed in headless Google Chrome on the Silver M5 Max (18 logical
CPUs, load averages 2.72/8.05/6.65). One raw browser SSE connection admitted
256 distinct canonical `messages.thread` shapes; a 257th control returned HTTP
400 `owner/E_OWNER_BUSY` while the document remained responsive. The retained
`capacity-0` child then received a complete state containing all 12 unique
writes committed by a second client, ending at sequence 22, without a polling
query. The same run also re-proved two identical app consumers sharing one
logical stream and surviving single-consumer close.

An earlier version of the new witness waited for every one of the 256 initial
query deliveries and hit its 30-second observer deadline. It made no product
claim and was replaced by the exact boundary control above: admission is the
control acknowledgement, while sustained delivery is proved on the retained
target child. No deadline, owner capacity, or polling fallback changed.
