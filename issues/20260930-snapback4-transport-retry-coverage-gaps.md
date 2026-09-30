# Snapback 4: transport retry coverage gaps after lane KA (review Lows)

**Status:** Open
**Opened:** 2026-09-30
**Area:** SDK transport (`packages/snapback4/src/node-fetch.ts` and callers), LLP 3000 HTTP transport

Grok's review of lane KA (`~/sb4-intent/reviews/ka-r0.grok.md` on eb1000) was
READY with two Lows. Neither can duplicate a side effect:

1. **Two durable senders do not opt in to the reused-socket retry.**
   `local-delivery.ts` posts `/m/...` as `{...body, store_id}` without
   `retry_write`, and `identity-runtime.ts` posts `{id, args}` through
   `globalThis.fetch` (or an injected fetch) without it. A lost reply there
   is not retried at the transport. The delivery queue resends the same ID
   later and the receipt deduplicates it, so this only misses the fast
   recovery. Add the flag where the server's receipt deduplication applies,
   or narrow the report's claim that every durable dispatcher adds it.
2. **A retried `/changes` can overlap presence for one write.** This is
   bounded by the first heartbeat write, and the reconnect flag is
   idempotent. It does not leak a presence count or cause a second
   mutation. Confirm with a test, or document it in the presence contract.
