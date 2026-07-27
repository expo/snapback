# Schematize the kit-socket in-band reply grammar (LLP 0094 §0F residual)

**Status:** Open
**Opened:** 2026-07-27 (integration of the §0F gate work and the §0C.6
convergence)
**Systems:** Wire Protocol, Schema governance, Cloudflare arm
**Spec:** LLP 0094 §0F item 2 (decision), §0A.1 WS-kinds row, §0C.6 item 6

The two 2026-07-27 landings deliberately left one seam between them: the
marker-envelope/schema-gate pass schematized the kit-socket in-band
**request** grammar but held the **reply** grammar out of the gates because
it was mixed-dialect as served, and the response-shape convergence then made
the replies kit dialect throughout (`kind: "pong"` / `"current_as_of"` /
`"snapshot"` / `"error"`, snake_case members, full `Diagnostic` on errors).

Now that the served dialect is the one worth contracting:

- give the reply frames a Rust serde authority (alongside
  `KitSocketRequestFrame` in `src/live_wire.rs`) and committed schemas via
  `schema_export::artifact_schemas()` + `snapback-schemagen`;
- add positive/negative instances to `tests/artifact_schemas_v0.rs`; and
- extend `cloudflare/test/wire-schema-gate.mjs` to validate served reply
  bytes against the committed schemas (the request-side corpus already
  proves served-validator ↔ schema verdict parity; replies need the same).

When this lands, the §0A.1 caveat ("the reply grammar becomes
conformance-claimable when its committed schemas land") is retired and the
kit-socket row is fully governed.
