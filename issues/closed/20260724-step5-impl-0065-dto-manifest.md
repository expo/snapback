# 0065: versioned helper DTOs + profile identities in the Rust-owned manifest

**Status:** Done (2026-07-24) — continuation-token DTO rides the deferred cursor-runtime work
**Severity:** P3
**Systems:** Codegen, Schema authoring, Tooling
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §§3-4, LLP 0037, LLP 0004 (stable function identity)
**Marker:** step5-impl

Pin `owner.v1`, `owned-crud.v1`, `owned-unique-lookup.v1`,
`owned-keyset-pages.v1` identifiers in generated artifacts; land the exact
argument/result DTO schemas (page first/next shapes, continuation-token
presence/absence semantics) in the LLP 0037 Rust-owned manifest so drift
fails the existing gate; inherit LLP 0004 `{appId}:{exportedName}` identity.
S/M-sized.

**Resolution (2026-07-24):** every generated standard-pattern function now
carries its stable versioned identity — `standardPattern: { helper, profile }`
(`owned-crud.v1` / `owned-unique-lookup.v1` / `owned-keyset-pages.v1`, all
`owner.v1`) — plumbed from the helpers through define.mjs (closed spec field
with shape validation) into functions.manifest, with the Rust-owned
`StandardPatternIdentity` type on `FunctionDefinition` and regenerated
committed schemas (LLP 0037 drift gate now covers it). Argument/result DTO
schemas already land per operation with `additionalProperties: false` and
LLP 0004 stable ids. The one open sliver — the pages' opaque
continuation-token result DTO — is deliberately deferred with the
cursor-runtime work tracked in the candidate-conformance ticket, since the
token's shape is the cursor contract.
