# Snapback 4: Keep null narrowing inside the control-flow branch that proves it

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R33
Evidence: Reproduced through check
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The binder's narrowing logic changes an outer binding's type while compiling
a branch, and does not reliably restore the optional type after leaving it.
Code that is invalid on the other path can pass typechecking.

This program is accepted by `check` although the final expression also runs
when `x` is null:

```quarry
query q(x: int ?):
  if x != null:
    y = x + 1
  return x + 1
```

Make branch refinements lexical/path-sensitive and merge types at the join.
A refinement must not escape unless every continuing path proves it. Cover
if/else, nested conditionals, helper/loop scopes and early returns. Reject the
example above while preserving the legitimate pattern where the null branch
returns or refuses before the numeric expression.

## Implementation locations

- [crates/snapback4-lang/src/bind/program.rs](../../snapback4/crates/snapback4-lang/src/bind/program.rs)

## Resolution — 2026-09-13

Null refinements are lexical and merged only across continuing branches. Early returns/refusals can prove a continuation; skipped branches, helper scopes and loops cannot leak an unsupported refinement.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
