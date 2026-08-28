# Decide how non-`SNAPBACK_*` diagnostics enter the errors-as-docs ledger

**Status:** Open
**Owner:** Charlie Cheever / Claude (LLP 0193 owner)
**Systems:** Diagnostics, Guide, Codegen, Testing
**Date:** 2026-08-28
**Related:** LLP 0193, LLP 0317.000 O44/P4, Lane L8

## Question for LLP 0193

Should stable non-`SNAPBACK_*` product diagnostics join the existing
diagnostics registry and errors-as-docs ledger, or should a parallel extractor
and completeness check own them?

Lane L8 deliberately does not answer that program-level question. It routes
only the codes emitted by the eight published 0.1.29 Snapback benchmark lanes.
The population question is profile-neutral: the observed codes crossed
Explicit and Familiar authoring, and the eventual completeness rule must serve
both.

## Evidence

Those run logs emitted five non-`SNAPBACK_*` product diagnostics that the
current registry extractor cannot see:

- `CODEGEN_MODULE_EVALUATION_FAILED`
- `CODEGEN_MODULE_PARSE_FAILED`
- `CODEGEN_POLICY_INVALID`
- `FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS`
- `SCHEMA_STRUCTURED_ID_INTERIOR_UNSUPPORTED`

`FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS` already routed at
`guide/operating/diagnostics.md#diagnostic-quality-at-data-and-contract-seams`.
The other four previously had no occurrence under source `guide/` pages. L8
added profile-neutral Codegen routes in
`guide/getting-started/generated-artifacts.md`, an exact structured-ID route in
`guide/getting-started/your-first-backend.md`, and retrieval-eval coverage for
the lane searches. That closes the observed retrieval misses but leaves all
five codes outside LLP 0193's ledger.

The current extractor is intentionally narrower:

```js
export const DIAGNOSTIC_CODE_PATTERN = /(?<![A-Z0-9_])SNAPBACK_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_])/gu;
```

Source: `scripts/diagnostics-registry-source.mjs`.

## Decision required

Choose and document one owned completeness path that:

- discovers stable non-`SNAPBACK_*` product codes without weakening the
  existing `SNAPBACK_*` check;
- gives each discovered code an errors-as-docs ledger disposition and checked
  author-facing route; and
- migrates or explicitly dispositions all five observed prefix-invisible codes
  above.

The choice belongs to LLP 0193 because it changes the population and grading
unit of that program, not merely one guide route.
