# Snapback 4: Stop oversized query output before returning it

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R17
Evidence: Reproduced with an explicitly lowered output ceiling
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.002](../../llp/3000.002-end-to-end-resource-bounds.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`query` evaluates and constructs the entire result, calls `charge_output`, then
returns that same result even when the charge reports a query cut. Marking
`complete: false` does not enforce an output-byte ceiling.

Reproduction: set `Ceilings.output_bytes = 5` and query the literal
`abcdefghijklmnopqrstuvwxyz`. The full 26-character string is returned, with
the meter reporting an output cut. The test used a lower ceiling for a small
reproduction; the control-flow defect applies at the default ceiling too.

Define and enforce the bounded result behavior before oversized output is
returned or serialized into another large buffer. Preserve the card's
incompleteness/continuation semantics rather than arbitrarily truncating JSON.
Cover scalar, shaped and paged results at and just past the budget, and clarify
whether the charged representation is canonical value JSON or wire JSON.
Check mutation output remains atomic on refusal. LLP 3000.002 considers the
larger allocation and response-boundary design.

## Implementation locations

- [crates/snapback4-core/src/engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs)
- [crates/snapback4-core/src/engine/runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs)
- [crates/snapback4-core/src/meter.rs](../../snapback4/crates/snapback4-core/src/meter.rs)

## Resolution — 2026-09-13

Canonical tagged output is counted without a second full JSON allocation. An indivisible result exceeding its output ceiling refuses E_BOUND; mutation output overflow rolls back its writes.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-sim/tests/review_corrections.rs](../../snapback4/crates/snapback4-sim/tests/review_corrections.rs)
