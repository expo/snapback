# Coterie message envelope needs an explicit growth path for M6 scale replay

**Opened:** 2026-08-17
**Source:** Adapter-M3 round-2 architecture ruling

## Current constraint

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

## Author ruling and selected path (2026-08-24)

Choose **path 1, scoped**: keep the platform's ordinary query/result profile
at 1,024 and add an explicit, declaration-level `large-result-window-v1`
profile whose closed hard maximum is 10,000. Coterie v9 opts its one
`listMessages` live query into the qualified cap; declaration v8 remains
byte-frozen and executable at 1,024 with its message-1,025 refusal.

Cursor pagination is rejected for this envelope because it gives up
Snapback's atomic single-window exact-live semantics. Cutoff, insert, and
delete races across independently versioned pages are gap-free only under an
atomic cross-page client transition; “eventually converges” is not exactness.
The scoped result profile preserves one query, one subscription, and one
versioned `live_replace`, making the remaining risk a measurable single-window
evaluation/hydration/replacement/socket/memory cost.

LLP 0266's `Author ruling — M6 scoped result-profile growth (2026-08-24)`
section fixes the mechanism and gates it on a 10,000-message/50-member M6 cost
probe. It also requires a stored `messageEnvelopeCount`, atomically incremented
with each send, so `sendMessage@5` returns structured
`MESSAGE_ENVELOPE_EXCEEDED` before every write at message 10,001. A truncated
`.take(10_000).length` is explicitly not an admissible count.

V9 is a cap-parameter revision, not a page runtime: `listMessages` and
`sendMessage` move from compatibility token 4 to 5, the dependent
`markReceipt` extension moves from 1 to 2, and every other token is audited.
V8 keeps `messageHistoryEnvelopeLimit() === 1_024` and its 1,024/1,025 checked
fixture behavior; the helper is not globally retargeted.

The profile is a genuine new platform capability. The implementation lane
must create/accept its focused platform Spec and reconcile LLP 0004, LLP 0007,
LLP 0108, and LLP 0267 before changing runtime/codegen/harness limits. It then
implements v9, the stored-count migration, concurrent exact-live acceptance,
and the scoped LLP 0189 qualification digest. If 10,000 fails any predeclared
cost threshold, it must qualify a lower cap or return for an author ruling on
pagination/a new atomic primitive; it may not silently ship a slow window.

**Status:** author ruling and design landed; implementation is the next lane.
This ticket stays open. No platform constant, declaration bytes, compatibility
token, backend envelope, or Coterie capability claim changed in this lane.

## Done when

Before M6 claims scale replay beyond 1,024 messages, implement and qualify the
scoped result profile, versioned v9 cap/token routes, stored admission count,
10,000-row single-window concurrent-live semantics, 50-member cost probe, and
10,001 pre-write refusal while keeping the v8 fixture green.
