# API envelope schema requires fields the Rust serializer omits at their zero values

**Status:** Open
**Systems:** Contract, Rust core, Verification
**Date:** 2026-08-24
**Source:** dual code review (codex gpt-5.6-sol xhigh) of the app-api-md
fixture repair; verified against the tree at `2dfb176d6`.

## Incompatibility

`schemas/api.envelope.schema.json` lists `stream`, `authorityProfileDependence`,
**and** `authorizationDependence` as `required` on function entries
(`required` block near line 864), but the Rust projection omits each at its
zero value:

- `crates/snapback-types/src/manifest/types.rs:9383` —
  `#[serde(skip_serializing_if = "is_false")] pub stream: bool`
- `types.rs:9434` — `authorityProfileDependence`,
  `skip_serializing_if = "Vec::is_empty"`
- `types.rs:~9428` — `authorizationDependence`,
  `skip_serializing_if = "Vec::is_empty"` (predates the two above — this is a
  systemic pattern, not a one-commit slip)

The server serializes that projection directly
(`crates/snapback-types/src/api_envelope.rs:1025`), so an ordinary envelope
whose function has `stream: false` or an empty dependence array does not
validate against the committed schema. `scripts/generate-app-api-md.mjs:359`
rejects schema-invalid envelopes, so the `--server` path fails against a real
backend serving such functions. The fixture suite passes only because its
fixtures write the fields explicitly — correct against the schema as
committed, but not the production encoding.

## Fix directions (owner: the program that evolved the schema — `stream` via
`96059e6ed`, `authorityProfileDependence` via `14e1fa014` / LLP 0240 R1)

1. **Always serialize the zero values** — drop the `skip_serializing_if`
   attributes for required fields (additive wire change, keeps the schema's
   "always present" contract); or
2. **Make the three properties optional in the schema** with documented
   omitted-means-zero semantics, and regenerate the schema chain.

Either way, add a conformance case that validates a *serializer-produced*
zero-value envelope against the schema, so the encoding and the schema cannot
drift apart silently again.
