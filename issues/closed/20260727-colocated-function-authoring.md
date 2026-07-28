# Colocated function declaration and handler authoring

**Status:** Closed  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Authoring, Runtime, Code generation, Security, Packaging, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0004, LLP 0009, LLP 0010, LLP 0051, LLP 0065, LLP 0074

Every JS operation currently duplicates its name and navigation across
`functions.mjs`, `handlers.mjs`, `source`, `exportName`, and the global handler
registry. LLP 0004 already describes a colocated Handler API, but the shipped
authoring surface still requires the split form.

## Design gate

Before implementation, reconcile LLP 0004's Handler API with the current
isolated evaluator, artifact identity, public-manifest trimming, warm-VM
security, and data-tier boundaries. Run the author-invoked
`llp-super-refine` loop with fresh Fable 5 and Codex gpt-5.6-sol input on the
governing revision. The converged design must decide whether v1 accepts only
self-contained handler literals or introduces a bounded bundling model.

## Desired resolution

- Add an inline `handler` form for JS query/live-query/mutation/action
  declarations. The exported operation name is the runtime key; inline form
  has no `source` or `exportName`.
- Preserve explicit args, result, reads, writes, auth, uses, and
  `outgrewIr`. Never infer or widen authority from runtime behavior.
- Reject mixed inline/source forms, free-variable captures, unsupported
  syntax, imports, or helper dependencies with stable source spans and codes.
- Bind admitted handler bytes to complete artifact/function identities while
  keeping executable source out of public inspection.
- Keep the legacy `source`/`exportName` form compatible through a documented
  transition period.

## Acceptance

- Type fixtures and native execution cover inline query, live query, mutation,
  and action handlers, precise results, atomic writes, and read/write ceilings.
- A capture/import rejection preserves the previously generated complete graph
  and never reaches runtime.
- Regeneration is byte-identical; a handler-byte change changes every required
  identity and stale clients/loads refuse.
- Public manifest/inspect output contains no executable source.
- A maintained demo, preferably Signal Desk, removes the duplicate declaration
  and registry wiring without losing acceptance coverage.
- LLP/guide implementation notes, `@ref`s, package inventory, and legacy
  compatibility tests land with the code.

## Resolution

Resolved 2026-07-28 by the LLP 0108 implementation slice.

- `defineJsQuery`, `defineJsLiveQuery`, `defineJsMutation`, and `defineAction`
  accept one direct inline handler expression. Codegen extracts its authored
  AST and span before isolated definition evaluation, replaces it with an
  authenticated marker, and emits one private runtime module per operation.
- Mixed legacy/inline forms, indirect handlers, free identifiers, dynamic
  import, ambient `this`/`super`, class syntax, `globalThis` escape attempts,
  static constructor reflection, spreads, computed handler properties, and
  accessors fail with stable source-located diagnostics before the previous
  complete generated graph can be replaced.
- The canonical inline AST participates in `implementationHash`; unchanged
  regeneration is byte-identical, while a handler-byte change rotates the
  implementation and complete artifact identity. Public API/provider/inspect
  artifacts carry hashes and contracts but no executable source or source
  location.
- Signal Desk now keeps its JS operations entirely in
  `demos/backend-bakeoff/snapback/functions.mjs`; the parallel
  `handlers.mjs` registry and all `source`/`exportName` wiring are gone.
  Its app-specific acceptance remains 3/3.
- Focused evidence is `volta run --node 24 npm test` in
  `packages/snapback-codegen`, `cargo test --test handler_settlement_v0`
  (11/11, including inline query/live-query/mutation/action), and
  `volta run --node 24 npm run test:snapback:extras` in Signal Desk.

The legacy module form remains compatible. `inline_handler_v1` remains an
experimental, explicit admission capability while LLP 0108 is in Review; this
ticket closes the implemented repository work without claiming proposal
ratification or a broader static module-bundling profile.
