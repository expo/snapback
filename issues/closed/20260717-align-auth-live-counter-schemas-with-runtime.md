# Align auth/live counter schemas with runtime validation

**Status:** Closed
**Severity:** P2
**Systems:** Auth invalidation, Authorized leases, Live protocol, JSON Schema
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0037; LLP 0053; LLP 0058; LLP 0059
**Marker:** schema, protocol-counter, auth, live, javascript-safe

Auth invalidation and authorized-lease runtime validators reject monotone
protocol counters above JavaScript's exact integer domain, but several generated
JSON Schema fields omitted the same maximum. Consumers could therefore accept
issuer, connection, scope, query, obligation, resolution, retirement, and lease
identity values that the serving protocol would always refuse.

**Done when:**

- Every emitted auth/live counter governed by the shared portable protocol
  domain publishes the same maximum as its runtime validator.
- The constraint propagates into standalone and embedded live, connection,
  query, and authorized-lease schemas.
- Consumer-side schema regressions accept the final portable value and reject
  max-plus-one for representative identity and frontier fields.
- Generated schemas remain derived from the Rust authority.

## Resolution

The Rust schema authorities now annotate every affected identity, revision, and
retirement frontier with the shared protocol-counter maximum. Schema
regeneration propagates that bound through all embedded artifacts, and focused
consumer regressions exercise both the last valid value and max-plus-one
refusal. Runtime semantics are unchanged; the published contract now describes
the validation that was already enforced.

Focused proof on 2026-07-17:

- `cargo test --test artifact_schemas_v0 -- --nocapture` — 22 passed, including
  max/max-plus-one auth invalidation and authorized-lease schema regressions.
