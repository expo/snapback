# Colocated function declaration and handler authoring

**Status:** Open  
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
