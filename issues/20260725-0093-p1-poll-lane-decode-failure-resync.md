# kit: poll-lane post-cut decode failure must force connection-wide resync (LLP 0095 T-DB-P)

**Opened:** 2026-07-25
**Source:** LLP 0095 §4.3 (deciding LLP 0093 Round-7 Fable suggestion 4 —
the poll-lane analogue of D3 fact 2b).
**Systems:** Client SDK, Tests

LLP 0095 pins the two lanes' never-silently-stale guarantees symmetric: a
durable item in an **acknowledged** drain batch whose payload fails to
decode is lost exactly like a `durable_bytes` payload (the LLP 0059
ownership cut has passed; no redelivery), so the required transition is the
same connection-wide forced-resync class — deliver the batch remainder,
surface the diagnostic, resubscribe everything, clear retained overlays.
The corpus fixture
(`poll.acknowledged_batch.malformed_item_forces_resync` in
`schemas/live.wire-fixtures.v1.json`) already states the obligation.

The JS kit does not conform yet: `drainConnection`
(`packages/snapback-client/index.mjs`) surfaces
`SNAPBACK_ENVELOPE_DECODE_FAILED` in `decodeFailures` and delivers the
remainder, but takes no resync transition — the same silently-stale hazard
class the socket lane's `durable_bytes` fix closed
(`issues/closed/20260724-durable-bytes-silent-staleness.md`).

## Fix sketch

In `drainConnection`'s durable decode-failure branch, after recording the
diagnostic, route the existing production sentinel
(`durableBytesResyncSentinel()`, marked with the drain envelope's authority
capture) through `routeDurableLaneFrame` — the identical recovery choke
point the socket path uses — and extend
`demos/_kit/tests/regression-durable-bytes-resync.mjs` (or a sibling
poll-lane regression) to prove lost-commit recovery through a poisoned
drain batch. Consider whether the sentinel reason should stay
`durable_bytes_undecodable` or gain a lane-honest sibling constant; either
way it remains client-synthesized, never wire-emitted (LLP 0095 §4.2).
