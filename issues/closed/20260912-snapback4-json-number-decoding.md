# Snapback 4: Reject unsupported JSON numbers instead of replacing them with zero

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R25
Evidence: Reproduced using the public JSON argument decoder
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The untyped JSON decoder maps a number through `as_i64().unwrap_or(0)`.
Fractional values and integers outside that conversion silently become zero;
large nested integers that do convert also need the value model's bounds.
An accepted write can persist data different from what the caller sent.

Reproduction: decode `{"price":1.25}` as `ArgType::Json { max_bytes: 1000 }`,
then encode it back to wire JSON. The result is `{"price":0}`.

Preserve every admitted numeric value exactly or return a typed input refusal
when the retained value model cannot represent it. This ticket does not demand
adding floating-point values to that model. Apply the rule recursively to
arrays/objects, enforce the intended i53 boundary, and test fractional,
negative, i53-boundary, unsigned-overflow and nested inputs through both HTTP
arguments and row conversion. No fallback-to-zero path should remain.

## Implementation locations

- [crates/snapback4-core/src/wire.rs](../../snapback4/crates/snapback4-core/src/wire.rs)
- [crates/snapback4-core/src/value.rs](../../snapback4/crates/snapback4-core/src/value.rs)

## Resolution — 2026-09-13

Untyped JSON conversion returns checked errors recursively; fractional, out-of-i53 and otherwise unsupported numbers are rejected rather than converted to zero, including nested JSON/list/asset values.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-sim/tests/review_corrections.rs](../../snapback4/crates/snapback4-sim/tests/review_corrections.rs)
