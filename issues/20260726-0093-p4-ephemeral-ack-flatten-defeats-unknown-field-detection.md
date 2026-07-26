# 0093 P-4 spec defect: `ephemeral_ack`'s flattened body makes the `ignore_unknown_fields` obligation undecidable on that kind

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Realtime, Tests

## The defect

`negative.unknown_field.tolerated` makes `ignore_unknown_fields` an
**asserted action**, not merely permitted behavior. Under LLP 0095 §2.1
rule 1 (actions are an exact set) a client must therefore *detect* unknown
members on known kinds — not just tolerate them — or it cannot emit the
action when the corpus requires it, and must not emit it when the corpus
does not.

That is decidable for every socket frame except one.
`LiveSocketServerFrame::EphemeralAck` is:

```rust
EphemeralAck {
    #[serde(rename = "requestId")] request_id: Option<String>,
    operation: String,
    #[serde(flatten)] body: Map<String, Value>,
}
```

The operation-specific result body is **flattened alongside** the envelope
members, so on `ephemeral_ack` every non-envelope member is *expected*.
"Unknown member" is not a well-defined predicate on that kind, and
`live.socket-server.schema.json` cannot express the distinction either.

No document mentions this. A clean-room client that implements one uniform
unknown-member check across the socket union emits a spurious
`ignore_unknown_fields` on every single `ephemeral_ack` it receives — which
under rule 1 is a conformance failure the moment an ephemeral fixture class
exists.

## Cost

Small — perhaps 20 minutes, and only because I chose to implement detection
rather than blind tolerance. But it is a trap that gets *more* expensive
later: the corpus has no ephemeral fixtures today, so a client can be wrong
here and pass, and only discover it when the ephemeral fixture classes land.

## Resolution taken in the Dart client

`_controlUnknownMembers` returns an empty list for `ephemeral_ack` with an
inline comment (`clients/dart/lib/src/wire.dart`).

## Fix wanted

1. LLP 0094 §0C.2's `LiveSocketServerFrame` row notes that `ephemeral_ack`
   carries a flattened body and is therefore **exempt from unknown-member
   detection** — the same way §0C.2 already carries per-family closure
   notes.
2. When the ephemeral fixture classes are seeded, include one
   `ephemeral_ack` fixture whose `expect.actions` deliberately omits
   `ignore_unknown_fields` despite extra members being present, so the
   exemption is machine-asserted rather than prose.
