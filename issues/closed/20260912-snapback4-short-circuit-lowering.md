# Snapback 4: Keep right-hand lowering inside short-circuit branches

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R21
Evidence: Reproduced through the CLI
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The binder lowers the right side of a boolean expression into the shared
statement output before the runtime `And`/`Or` expression can short-circuit.
Null assertions, helper setup and other statement-producing expressions can
therefore execute in a branch that should be skipped.

With a readable empty `items` table, this query refuses with `MISSING` instead
of returning true:

```quarry
query q():
  return true or ((items['missing'] ! else MISSING) != null)
```

Lower control flow so all right-hand work remains inside the branch in which
it is evaluated. Cover `true or`, `false and`, nested booleans, required point
reads, helper calls and any admitted write-producing expression. Verify skipped
branches neither refuse nor mutate, selected branches run exactly once, and
Rust and TypeScript execute the same corrected IR.

## Implementation locations

- [crates/snapback4-lang/src/bind/program.rs](../../snapback4/crates/snapback4-lang/src/bind/program.rs)

## Resolution — 2026-09-13

Right-hand setup and evaluation stay inside the selected boolean branch. Helpers, assertions and writes on skipped paths remain unevaluated; ordinary strict expressions preserve their source order.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
