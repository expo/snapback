# Graph codegen can emit carriers the Rust host refuses

**Status:** Open  
**Owner:** graph-profile codegen / admission parity  
**Governing:** LLP 0209 §§2.1–2.3, Stage B  
**Found:** 2026-08-23, G0 Stage B3

## Problem

B3 exposed two source/lowering checks missing from the JavaScript admission
twin. In both cases `generateInProcess` succeeded, but deserializing or
host-reconstructing the emitted `GraphQueryCarrierV1` failed in Rust:

1. A literal bounded-to-many page containing only `{kind: "literal", take}`
   was emitted unchanged. Rust's `GraphLiteralPageV1` also requires
   `direction`, `lower`, and `upper`, so deserialization failed.
2. Nested projection objects used the projected child as their stored lexical
   `scopeNodeId`. Rust requires that object to retain the effective parent
   scope and then evaluates its leaves at the child scope, so host admission
   returned `SNAPBACK_GRAPH_PROJECTION_SCOPE_INVALID`.

B3 corrected its declarations explicitly. The general compiler gap remains:
successful codegen must not emit a carrier the Rust rank-0 host refuses.

## Acceptance

- Close literal-page source validation/lowering over all required wire fields.
- Make JavaScript projection-scope validation exactly match
  `validate_projection_scope_at` in Rust.
- Add positive and one-axis negative JS/Rust parity vectors for both shapes.
- Prove every successfully generated graph fixture deserializes and
  `graph_plan_identity_v1` exact-matches in Rust.

```sh
volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs
cargo test -p snapback --test graph_corpus_v1
```
