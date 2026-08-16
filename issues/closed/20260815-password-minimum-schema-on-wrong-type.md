# Committed schema puts `passwordMinimumLength` on Ask, not Auth

**Status:** Closed
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

## Resolution (2026-08-15)

`src/contract_types.rs`, the schemars generator authority, now binds
`AuthManifest.password_minimum_length` to the Rust floor and ceiling constants.
Regenerating `schemas/schema.manifest.schema.json` places
`passwordMinimumLength` only on `AuthManifest` with range 8–128.

`tests/artifact_schemas_v0.rs` strengthens DK-7 with a targeted structural
ownership/range assertion and validation cases for `auth` success, both range
edges, and rejection under `api.ask`. This is targeted rather than a new generic
Rust-field-to-schema-object correspondence checker. Evidence:

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 35 filtered out; finished in 0.08s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 2706 filtered out; finished in 0.26s
```

The broader pre-existing DK-7 drift gate still reports
`functions.manifest.schema.json` drift; that generated output is unrelated to
this AuthManifest correction and was not folded into this ticket.
