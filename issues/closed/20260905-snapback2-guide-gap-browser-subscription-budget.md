# guide-gap: browser subscription lifetime and connection limits

**Status:** Closed — shared SSE transport, 2026-09-05
**Systems:** Snapback 2 client, installed live-query recipe
**Evidence:** Diary 0116; `benchmarks/runs/2026-09-05-snapback2-loop/run.json`

The reduced Clique app mounts all 14 held rooms, hiding inactive rooms only
with HTML. Each opens three SSE subscriptions, plus per-message receipts.
The client opens a distinct HTTP/1.1 SSE fetch per subscription. Both browsers
select the correct DM but render neither history nor roster; the send input
remains populated and the acceptance times out. API two-client chat passes.

Hidden-room subscriptions are a confirmed app mistake. Browser connection
starvation is a strong inference, not a proven platform cause: no network
capture was retained. Reproduce with a bounded browser network trace, identify
the minimum necessary simultaneous-query budget, and explain subscription
lifetime in the installed recipe. Evaluate transport changes only from that
evidence. Do not claim a multiplexing fix or a passing Clique bar from this run.

## Resolution — 2026-09-05

Replaced the public client's per-subscription connections with one shared SSE
stream for queries and channels. Batched controls change the mounted set without
restarting other subscriptions. Owner authorization and client custody fences
remain per subscription/session; backpressure is bounded per logical stream.
The installed live-query recipe teaches subscription lifetime.

A Chromium 153 probe on HTTP/1.1 received all 60 initial query results, delivered
a mutation to all 60, and completed an ordinary query while using one physical
SSE stream. The real-owner regression also covers channel delivery, unsubscribe,
a refused operation isolated from other queries, foreign-authority controls,
and reconnect. This establishes the new transport's behavior; it does not
retroactively prove connection starvation caused the old benchmark failure.
