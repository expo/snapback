# 0065: versioned helper DTOs + profile identities in the Rust-owned manifest

**Status:** Open
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
