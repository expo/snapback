# kit: ignoring `durable_bytes` permits silent permanent staleness

**Opened:** 2026-07-24
**Found by:** LLP 0093 super-refine Round 6 (Codex reviewer, concern 2 —
`llp/reviews/0093-client-protocol-and-native-clients.codex.md`)
**Systems:** Client SDK, Realtime

## Defect

`LiveSocketServerFrame::DurableBytes` exists so a durable payload that fails
UTF-8 decoding is never dropped silently (`src/live_wire.rs:188-191`;
emitted by `live_stream_text`, `src/local.rs:12721-12729`). But by the time
the frame reaches the client, the WebSocket handoff has already accepted and
removed the payload's outbox lease (`src/server.rs:17569-17580`) — the
update is gone and cannot be re-drained.

The JS kit declared the kind "knowingly ignored"
(`packages/snapback-client/index.mjs`, `LIVE_SOCKET_KINDS.DURABLE_BYTES`
comment; the schema gate `demos/_kit/tests/live-wire-schema.mjs` listed it
as acknowledged-unhandled). A client on a healthy socket that receives
`durable_bytes` therefore loses an acknowledged durable update while
continuing to report `live`/current — silent permanent staleness. The old
comment's claim that "the next drain forces a resync" is wrong on the socket
path: while the socket owns the outbox, no drain runs.

## Required behavior

LLP 0093 D3 fact 2b: `durable_bytes` carries a required recovery
transition — forced resync. Because the raw bytes cannot identify which
subscription the lost envelope belonged to, recovery is connection-wide.

## Resolution

Fixed in the same change that closes this ticket: `#dispatch` now routes
`durable_bytes` through `dispatchDurableBytesFrame`, which delivers the raw
frame to external `onDurable` listeners (unchanged observability) and then
synthesizes the same connection-wide clear-retained `resync_required`
sentinel the server emits for outbox poison
(`durableBytesResyncSentinel()`, reason `durable_bytes_undecodable`,
authority capture propagated) into the durable lane registry — driving every
live handle through fresh snapshot-with-subscribe and blanking every
ephemeral overlay via the existing cross-lane routing.

Covered by `demos/_kit/tests/regression-durable-bytes-resync.mjs` (unit:
the dispatch transformation; integration: the sentinel drives a stale
handle back to fresh rows through the production registry path), wired into
`scripts/verify-local-proof`.
