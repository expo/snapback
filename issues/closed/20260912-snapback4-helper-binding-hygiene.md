# Snapback 4: Give inlined helpers fresh lexical bindings

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R20
Evidence: Reproduced through the CLI
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Helper expansion emits `Let` bindings using the helper's parameter names in
the caller's flat runtime environment. A later call overwrites values still
referenced by an earlier expanded expression. Helpers can also clobber caller
bindings with the same name.

This complete Quarry program returns 4 instead of 3:

```quarry
fn identity(x: int): x
query q():
  return identity(1) + identity(2)
```

Apply hygienic renaming or a real lexical call scope when lowering helpers and
procedures, including their locals and temporaries. Evaluate each argument once
in source order and preserve its value for the call. Verify repeated calls in
one expression, nested calls, caller/helper name collisions, and a helper
inside a loop. Run the emitted IR on both interpreters; patching a single
expression at the server evaluator would leave the lowered program incorrect.

## Implementation locations

- [crates/snapback4-lang/src/bind/program.rs](../../snapback4/crates/snapback4-lang/src/bind/program.rs)
- [crates/snapback4-core/src/engine/runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs)

## Resolution — 2026-09-13

Helpers, procedures, loops and compiler temporaries use fresh lexical bindings. Arguments and compound expressions preserve source evaluation order and execute once; stable row-field projections retain pending provenance.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
