# Snapback 4: Escape literals and property names in generated TypeScript

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R24
Evidence: Reproduced through check and inspection of generated output
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The emitter places enum variants directly between double quotes without
escaping. Valid Quarry can therefore pass `check` while producing invalid
TypeScript that fails the application's next typecheck.

Reproduction: declare `label: enum('has"quote', 'ok')`. `check --json` reports
`ok: true`, then writes:

```ts
label: "has"quote" | "ok";
```

Use a proper TypeScript/JSON string-literal encoder for enum values and any
other emitted string/property/module names. Cover quotes, backslashes, control
characters and Unicode, and typecheck the resulting generated artifact rather
than only asserting it contains a substring. Preserve the source-level enum
values exactly.

## Implementation locations

- [crates/snapback4-lang/src/emit.rs](../../snapback4/crates/snapback4-lang/src/emit.rs)

## Resolution — 2026-09-13

Generated literals and property names use JSON escaping including Unicode line separators. Computed __proto__ properties preserve an own API operation. Tests import and strictly typecheck the generated artifact.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
