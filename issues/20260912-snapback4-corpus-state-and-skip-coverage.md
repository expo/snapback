# Snapback 4: Assert retained result states and distinguish intentional corpus exclusions

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R27
Evidence: Code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The conformance runner's `Expected` structure does not include completeness
or continuation, so a matching result can pass with the wrong `complete` or
`next`. It broadly skips every `partial` and `certification-refused` case,
including structural refusals retained by the brief, and turns schema
validation failures into skips. A regression can therefore reduce exercised
coverage while keeping the runner green.

Decode and compare the expected states/continuations for supported cases.
Distinguish the intentionally removed static-pricing/custody surfaces from
retained language/structural semantics. A previously supported schema or case
becoming unsupported must fail visibly rather than silently increase skips.
Keep named skip reasons without counting exclusions as passes.

Run the supported semantic cases on the actual TypeScript interpreter as well
as Rust, or clearly report that the current result only establishes server
conformance. Use the existing runner/test entry point; this ticket does not
ask for a new registry, blocking gate, or revival of deliberately deferred
features. LLP 3000.003 covers how implementation and simulator evidence differ.

## Implementation locations

- [crates/snapback4-core/tests/corpus.rs](../snapback4/crates/snapback4-core/tests/corpus.rs)
- [crates/snapback4-sim/src/replica.rs](../snapback4/crates/snapback4-sim/src/replica.rs)
