# snapback2: the offline carrier admits one writer per account partition, so a second browser tab needs its own database and its queue never merges

**Status:** Resolved on main — 2026-09-08

**Date:** 2026-09-06 · **Area:** snapback2 offline arm (LLP 1012 browser carrier) · **Source:** Clique full run, astra-snapback2 ("Final M8 correction boundary", essay)

## What happened

Multi-tab testing hit the published one-writer-per-partition restriction of the browser carrier.
To keep two tabs working the builder scoped each tab to its own database and lock namespace,
which restored ordinary behaviour, but "secondary-tab queue merging remains a limitation":
writes queued in the second tab do not join the primary tab's outbox. An attempted store wrapper
(a proxy around the carrier) was the wrong abstraction and failed the durability regression; the
builder kept the official carrier and recorded the failed experiment. Primary-tab close and
relaunch durability passed.

The builder's summary: "adapting its ownership model was significant application work" and
"compact backend code can leave substantial lifecycle work at its boundaries."

## Proposed

1. Decide and document the multi-tab story: leader election with a shared outbox (the usual
   BroadcastChannel/Web Locks pattern) or explicit per-tab partitions with a documented merge on
   leader change.
2. If per-tab partitions stay, the guide's offline page needs the recipe (database and lock
   namespace per tab) and the limitation stated plainly.
3. Regression: two tabs, one offline write in each, reconnect; both writes settle.

## Partly resolved (2026-09-07, LLP 1018 move one)

Proposal 1 is decided and built: the second tab is a **follower** (live reads,
`outbox.status()` reason `follower`, writes refused `E_OFFLINE_FOLLOWER`), waits on
the Web Lock outside startup, and inherits the partition and its queue when the writer
closes; the wait is withdrawn on close, sign-out, and account change (LLP 1018 §3,
LLP 1012 §4 amendment; `tests/client-sessions.test.ts`). Proposal 2's recipe is no
longer needed: no per-tab database. Proposal 3's regression (an offline write in
*each* tab, both settle) stays open by design and moves to
`issues/20260907-snapback2-follower-tab-write-forwarding.md`.

## Resolution — 2026-09-08

The shared writer/follower carrier now admits both tabs into one durable queue. Actual browser-page closure transfers ownership and replays once in admission order; the per-tab database workaround is obsolete.

`client-sessions.ts`, `client-forwarding.ts`, and `store/forwarding.ts`; `scripts/witness-web.mjs` queues writer/follower/writer while offline, closes the actual writer page, and asserts FIFO replay and exactly one server row per intent. The final architecture Chrome witness passes 16/16.

Evidence was reconciled against main `2ac15dc2c`. LLP 1018.000 §10 completion records canonical qualification at `c20a37e22` and final package/Chrome qualification at `ab8b225e6`; unchanged native/evaluator/compiler inputs retain their earlier execution evidence. This reconciliation ran no new product tests. It closes the filed source defect; release and fresh published-package confirmation remain separately tracked.
