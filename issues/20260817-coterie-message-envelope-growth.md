# Coterie message envelope needs an explicit growth path for M6 scale replay

**Opened:** 2026-08-17
**Source:** Adapter-M3 round-2 architecture ruling

## Current constraint and ruling

Snapback's platform live-window ceiling is 1,024 rows:

- `src/manifest.rs` defines `QUERY_MAX_LIMIT = 1_024`.
- `packages/snapback-harness/ctx-bootstrap.js` rejects `.take(n)` above
  1,024 with `SNAPBACK_QUERY_LIMIT_INVALID`.
- the function `records` contract in `src/manifest.rs` requires
  `maxItems <= 1_024`.

Coterie M3 therefore closes its product envelope at 1,024 messages per
conversation. `listMessages` returns that full envelope as one live window,
and `sendMessage` refuses `MESSAGE_ENVELOPE_EXCEEDED` before message 1,025 can
be written. Chats use their separately ruled 1,000-row envelope.

Chat creation and `addMember` likewise refuse before enrolling a profile in
chat 1,001. This is sufficient for M3 correctness, but M6 scale replay needs a message
history larger than the current one-window platform limit. It must not silently
raise the Coterie claim or reintroduce a one-shot non-live tail.

## Candidate growth paths

1. **Grow the engine live-window limit.** Raise the platform query/result
   ceilings together, qualify the larger live reevaluation and delivery cost,
   and then deliberately raise Coterie's backend and mutation envelopes.
2. **Version Coterie's frozen surface for cursor pagination.** Add a cursor to
   `listMessages` following the provider-neutral `listFeed@3` architecture:
   opaque declaration cursor, backend keyset translation, one live page per
   subscription, and an explicit compatibility-token bump. This is a future
   declaration revision; v8 remains byte-frozen.

## Done when

Before M6 claims scale replay beyond 1,024 messages, choose and qualify one
path, update the declaration/token if pagination wins, and add acceptance that
proves both history reachability and the exact live semantics the chosen path
claims.
