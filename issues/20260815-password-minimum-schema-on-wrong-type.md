# Committed schema puts `passwordMinimumLength` on Ask, not Auth

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Auth, Artifact schemas, Codegen
**Date:** 2026-08-15
**Governing:** DK-7 / `src/contract_types.rs` `AuthManifest`
**Related:** `issues/20260815-artifact-schemas-v0-committed-output-drift.md`
(generic drift; this is a specific misplaced property)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

Rust `AuthManifest` owns `passwordMinimumLength`
(`src/contract_types.rs:724-729`). The committed JSON schema
(`schemas/schema.manifest.schema.json`) puts that property on
**`ApiAskManifest`** (0–65535, `:118-126`) and omits it from
`AuthManifest` (`:499-530`, `additionalProperties: false`).

Runtime serde accepts a lawful `auth.passwordMinimumLength`. JSON-schema
consumers reject that same document and would accept the key on Ask,
where it is meaningless. The closed password-minimum ticket claimed the
generated schema describes the setting.

Distinct from the unconfirmed generic `artifact_schemas_v0` drift
ticket: codegen’s DK-7 check is shallow and does not catch this
placement error.

## Desired outcome

Regenerate so `AuthManifest.properties.passwordMinimumLength` is 8–128
(or matches the Rust floor/ceiling) and `ApiAskManifest` does not carry
the field.

## Acceptance

- A schema document with `auth.passwordMinimumLength: 12` validates.
- The same key on `api.ask` is rejected.
- Range matches `AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR` /
  `AUTH_PASSWORD_MINIMUM_LENGTH_CEILING` (8–128), not 0–65535.
