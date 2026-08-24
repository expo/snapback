# Coterie message envelope needs an explicit growth path for M6 scale replay

**Opened:** 2026-08-17
**Source:** Adapter-M3 round-2 architecture ruling

## Current constraint and ruling

Snapback's platform live-window ceiling is 1,024 rows:

- `crates/snapback-types/src/manifest/types.rs` (the current home of the
  original `crates/snapback/src/manifest.rs` surface) defines
  `QUERY_MAX_LIMIT = QUERY_DEFAULT_LIMIT = 1_024`.
- `packages/snapback-harness/ctx-bootstrap.js` rejects `.take(n)` above
  1,024 with `SNAPBACK_QUERY_LIMIT_INVALID`.
- the function `records` contract in
  `crates/snapback-types/src/manifest/types.rs` requires
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

## Design recommendation landed (2026-08-24)

LLP 0266's dated section
`Dated recommendation for author ruling — M6 message-envelope growth
(2026-08-24)` recommends **path 2** and records the qualified design: a
separate v9 declaration, `listMessages@5` plus `sendMessage@5`, an opaque
conversation-bound cursor translated to a strict sequence keyset, 200-row
pages with a 201st-row boundary witness, one live backend query per subscribed
page, downstream live-page re-anchoring when a predecessor boundary moves,
and a claim-gated 10,000-message M6 acceptance suite.

The recommendation is based on current code: the 1,024 maximum is also the
platform's implicit query default and result/harness ceiling, while Coterie's
ordered authored live query uses full re-query/replacement delivery. Raising
that platform-wide ceiling would broaden reevaluation and delivery cost for
every application. The existing provider-neutral `listFeed@3` implementation
proves opaque cursor translation and live cursor pages; the LLP 0266 design
adds the moving-boundary invalidation rule needed to avoid a stale or gapped
message archive.

**Status:** design and recommendation landed; author/owner confirmation of
path 2 is still required before implementation. This ticket stays open. No
platform ceiling, declaration bytes, compatibility token, backend envelope,
or Coterie capability claim changed in this lane.

## Done when

Before M6 claims scale replay beyond 1,024 messages, choose and qualify one
path, update the declaration/token if pagination wins, and add acceptance that
proves both history reachability and the exact live semantics the chosen path
claims.
