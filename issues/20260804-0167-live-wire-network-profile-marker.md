# LLP 0167: socket frame marker must ride the generated live wire types

**Opened:** 2026-08-04
**Systems:** Client protocol, Server
**Related:** LLP 0167 (honesty requirements), LLP 0093 (client protocol)

The LLP 0167 Rust core landed with the HTTP `snapback-network-profile`
marker (CORS-exposed) but **skipped the socket frame annotation**: live
envelopes are schema-generated wire types (`src/live_wire.rs`), so the
per-frame profile marker is a versioned protocol change that cascades
through the LLP 0093 fixtures and the Swift client. The delayed live
frames carry their immutable profile snapshot server-side
(`DurableMessage::network_egress`) — the data is captured, only the wire
projection is missing.

Done means: frame annotation added through the generated compatibility
path, LLP 0093 fixtures updated, Swift client tolerant of the new field,
and the LLP 0167 acceptance bullet "every delayed response carries the
profile marker" holds on the socket lane, not just HTTP.
