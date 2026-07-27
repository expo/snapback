# Sound end-to-end handler result contracts

**Status:** Open  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Authoring, Runtime, Code generation, Client typing, React, Contract, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0004, LLP 0012, LLP 0032, LLP 0037, LLP 0064, LLP 0065

JS queries can declare `result: v.object(...)`, but the declaration currently
serves codegen typing only. Runtime egress does not validate it,
`jsQueryRowDescriptor` adds document system fields even to computed records,
mutations/actions cannot declare precise results, and React inference still
depends on caller-supplied generics. Omitted results degrade honestly, but the
ordinary typed path is incomplete and has a soundness hole.

## Desired resolution

- Define distinct closed result contracts for stored document rows, computed
  query records, mutation returns, and action returns.
- Carry the declared schema through the Rust-owned function manifest and
  validate handler egress before publication/settlement with stable,
  path-specific diagnostics.
- Never invent `_id`, version, or timestamp fields for computed records.
- Support validators for scalar, id, object, array, optional, union, and JSON
  shapes where the shared validator contract supports them.
- Generate function references whose Args and Result phantoms flow through
  headless, provider introspection, Contract, React query groups, query hooks,
  and mutation hooks without casts or manual generic annotations.
- Keep omission as an honest `unknown` path with an actionable author summary;
  do not infer a result from opaque JavaScript.

## Acceptance

- A TypeScript consumer compiles generated query and mutation calls, React
  hooks, and grouped queries without casts or explicit result generics.
- Runtime tests refuse malformed nested, optional, union, id, scalar, object,
  and array results before any invalid live/settlement publication.
- Stored-document and computed-record fixtures prove correct system-field
  behavior. Mutation result replay retains the validated typed shape.
- Generated provider, Contract, operation-schema, and public API artifacts are
  deterministic and agree on the same result contract.
- Degraded operations are counted with authored source links and exact
  `result` remediation; hard errors preserve the previous complete artifact
  graph.
- Guide pages teach the declaration and explain why opaque inference is
  deliberately unavailable.
