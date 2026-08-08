# Stored table fields reject literal-union (enum) validators

**Opened:** 2026-08-08 · **Severity:** P3 (schema surface; duplicate fail-closed guards in every app)

`v.union` of literals is rejected on stored table fields
(`SCHEMA_INVALID_VALIDATOR`, probed at scaffold time), so source varchar
enums (`role: crew|user`, `visibility: internal|public`) are stored as
`v.string()` and every writer/ingest path re-implements the closed-domain
guard (the control's `W-ENUM`: compiler guards + ingest guard + every Lane 4
writer). Authorization-relevant domains (role, visibility) deserve
schema-level closure so query auth can never treat an unknown role as crew.

Ask: admit closed literal-union validators on stored fields (or a dedicated
enum declaration) with generated-contract support. Removes W-ENUM.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution 2026-08-08 — implemented

Closed string-literal domains are admitted on stored table fields.

```js
role: v.union([v.literal('crew'), v.literal('user')]),
visibility: v.optional(v.union([v.literal('internal'), v.literal('public')])),
```

Two to seven unique non-empty string literals, each at most 64 UTF-8 bytes,
in authored order. Seven rather than the argument grammar's eight because an
optional field's document contract adds a `null` variant against LLP 0108's
eight-variant union bound; one bound for required and optional avoids an
evolution trap. No new authoring spelling: `v.enum([...])` was considered and
deliberately deferred so LLP 0127 move 1's unadjudicated one-grammar proposal
stays untouched.

- **Manifest:** `FieldType::Enum { values }`, emitted as
  `{"Enum":{"values":["crew","user"]}}`; the server re-establishes the same
  closed rules on ingest (`SNAPBACK_SCHEMA_ENUM_DOMAIN_INVALID`).
- **Storage:** a `TEXT` column, byte-identical to `v.string()`. Enum fields are
  string-like for equality filters, ordering, indexes, unique indexes, search
  and vector filters, bounded-children projections, relational join keys, and
  the live matcher.
- **Enforcement:** the central declared-field coercion behind `insert_document`
  and `patch_document` — so every writer (mutation plans, buffered handler
  writes, seeds, maintained projections) is covered by one guard. Out-of-domain
  strings refuse `SNAPBACK_FIELD_ENUM_VALUE_INVALID` naming table, field,
  value, and admitted list; non-strings still refuse
  `SNAPBACK_FIELD_TYPE_MISMATCH`. This is the W-ENUM removal: an unknown role
  can no longer reach storage through a writer that forgot its guard.
- **Generated types:** `"crew" | "user"`, and `null | "internal" | "public"`
  when optional, through `api.d.ts`, provider introspection, the Contract
  bindings, the args/result JSON Schema projection, and every document result
  contract expansion (search, vector, single-table delta, bounded children,
  snapshot-batch relational).
- **Evolution:** widening a domain, and going back to `v.string()`, apply
  without a scan. Narrowing — including tightening an existing `v.string()`
  field into a domain — is applied only after an in-transaction check over the
  predecessor rows, on the optional→required null-count precedent; a failing
  check refuses whole with `SNAPBACK_SCHEMA_ENUM_DOMAIN_BACKFILL_REQUIRED`
  naming an offending value, advancing neither manifest nor DDL. Wired on all
  four admission paths. Any other type ↔ enum transition stays
  `SNAPBACK_SCHEMA_FIELD_RETYPED`. LLP 0081's reviewed lane is untouched;
  aligning its `derive_intents` with the admitted transitions is a named
  follow-on.

**Design recorded in:** LLP 0004 §Dated alignment: stored literal-union domains
(grammar, representation, enforcement, what is not claimed); LLP 0007 §Dated
amendment: closed string domains and the identity-column boundary (the portable
type-map row, the deliberate rejection of a native Postgres enum type, and the
conservative-applier rule); LLP 0115 CV-4b carve-out note and board row (the
Spec commission for stored arrays and objects is unchanged).

**Guide:** `guide/getting-started/your-first-backend.md` gains the declaration,
the domain-change rule, and an explicit "there is no identity/default column"
pointer; `guide/capabilities.md` gains `backend.stored-enums` (shipped) and
`backend.identity-columns` (GAP), and narrows `backend.structured-stored-fields`
to arrays and objects.

**Evidence:** `cargo test --lib` 2275 passed / 0 failed / 2 ignored;
`packages/snapback-codegen` `npm test` exit 0 with
`stored-enum-authoring.test.mjs: 12 cases passed`; 11 new Rust tests
(`storage::stored_enum_tests` ×9, `manifest::stored_enum_result_contract_tests`
×2); `ref-check ok — 192 LLP docs, 4378 refs, 0 errors`;
`check-inventories PASS: 237 package tests`; `check-guide ok — 63 pages, 237
snippets`; `check-generated-artifacts ok`.

**Not in scope:** stored arrays and objects (LLP 0115 CV-4b, still Open) and
numeric identity/default columns (`20260808-numeric-identity-default-columns.md`,
author-gated under LLP 0191's identity-architecture Decision).
