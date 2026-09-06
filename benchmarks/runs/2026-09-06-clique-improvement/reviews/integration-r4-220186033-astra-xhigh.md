CHANGES_REQUIRED — 22018603331c4bc8e8a34134bf6d324c0512cffc

**P2 — FIFO still admits new intent after a typed terminal replay receipt.** The changed guard at [client-outbox.ts:111](/Users/ccheever/clique-improvement/reviews/integration-r4/astra/snapback2/packages/snapback2/src/client-outbox.ts:111) handles thrown terminal refusals only.

Concrete source-derived ordering, not executed:

1. Leave an older intent queued after HTTP 503.
2. Issue a new mutation, triggering the pre-enqueue FIFO drain.
3. Return HTTP 200 for the older replay with `{ state: "rejected", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session", intent: olderIntent }`.
4. With authority still current, `json()` returns this recognized terminal receipt. [drainQueued:230](/Users/ccheever/clique-improvement/reviews/integration-r4/astra/snapback2/packages/snapback2/src/client-outbox.ts:230) settles it as an ordinary rejection and finishes with `stopped: false`.
5. The new catch never runs. The new intent acquires custody at line 116 and reaches the wire. Returning 503 there leaves it durable for later replay, while the client remains authenticated without the originating terminal on its snapshot.

This is a supported terminal mutation shape, already exercised in [assets.test.ts:730](/Users/ccheever/clique-improvement/reviews/integration-r4/astra/snapback2/packages/snapback2/tests/assets.test.ts:730). The remaining defect is its treatment during FIFO replay. Terminal receipts need to stop admission and expire captured custody before the drain handles them as ordinary rejections.

The byte changes close my prior finding: complete Blob conversion, absent/bypassed caches, hits, admission, and final lease/viewed awaits all reach the combined authority/cancellation guard. The HTTP-401 FIFO paths preserve the originating refusal and older exact envelope; their recovery tests assert no new intent and one older execution. Upload cleanup and wire-handoff logic remain unchanged.

**Nonblocking:** the preserved sibling cancellation/sealed-store diagnostic race does not establish accepted-intent loss or successor-custody clearing.

Source review against `38d406d79` only. No edits, tests, network, credentials, benchmark app, or other review reports accessed. Reported execution results were not independently verified.