# 0093 P-2 spec defect: the drain response shape is not documented

**Opened:** 2026-07-25
**Source:** LLP 0093 D4 clean-room discipline (P-2 Swift client build).
**Systems:** Wire Protocol, Client SDK, Realtime

Building Lane P purely from LLP 0094/0095 + the committed schemas, the
documents never state what `GET /outbox/{connection_id}` actually returns:

- `realtime.envelope.schema.json` describes **one** envelope, and LLP 0095
  T-DRAIN describes the leased-batch *semantics*, but no document says the
  response body is a **bare JSON array of `RealtimeEnvelope`** (it is:
  `drain_outbox` ends in `Json(drained)`, `src/server.rs`). A clean-room
  implementer has to guess between `[...]`, `{"batch":[...]}`, and NDJSON.
- The unknown/reaped-connection answer is also undocumented wire behavior:
  the drain synthesizes a single wrapped
  `resync_required { reason: "unknown_or_reaped", clear_retained: true }`
  batch rather than refusing. That is load-bearing for T-GRANT-LOSS
  detection on the poll lane (the client sees a connection-wide resync, not
  an HTTP error) and appears nowhere in 0094/0095.
- Nothing states there is no client-visible acknowledgement step (the
  ownership cut rides the HTTP body poll itself; the client just GETs).

**Resolution taken in the Swift client (best effort):** decode the body as
a JSON array of `RealtimeEnvelope`; treat a non-array body as an
undecodable response; no ack call. Verified against a live local server.

**Fix wanted:** LLP 0094 §0A (or the P-1 lifecycle spec) documents the
drain response as `[RealtimeEnvelope]`, the synthesized
`unknown_or_reaped` batch, and the absence of a client ack step; ideally a
`live.outbox-drain.output.schema.json` joins the committed schema set so
the array shape is machine-governed like every other family.
