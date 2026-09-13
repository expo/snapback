# Snapback 4: Diagnose unrepresentable rule literals instead of compiling them as zero

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R32
Evidence: Compilation acceptance reproduced; zero lowering directly inspected
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Rule literal binding uses `text.parse().unwrap_or(0)` for numeric tokens.
Unlike ordinary expression validation, an unrepresentable numeric literal
silently becomes integer zero while retaining a successful compilation result.

Reproduction: a table with `n: int` and `read <- .n = 1.5` passes `check --json`.
The `Literal::Number` branch lowers `1.5` to `Value::Int(0)`. Values beyond i64
have the same fallback. The compiled rule therefore does not mean what its
source says.

Use the same checked literal parser and value-model bounds as ordinary Quarry
expressions. Refuse invalid integer/fixed-point forms at their source site;
never substitute a different number. Cover fractional, signed, out-of-range
and boundary literals in comparisons and probes, with positive tests for the
admitted forms. This ticket addresses compiler meaning; the separate review
owns any security implications of rule behavior.

## Implementation locations

- [crates/snapback4-lang/src/bind/schema.rs](../../snapback4/crates/snapback4-lang/src/bind/schema.rs)

## Resolution — 2026-09-13

Rule and ordinary literals share checked signed-i53 parsing. Unsupported fractional/overflow forms produce located diagnostics and never silently lower to zero.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
