# Snapback 4: Reject duplicate named index keys without panicking

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R22
Evidence: Reproduced through check
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Index selection verifies that each supplied name belongs to the candidate
index but does not establish a one-to-one match. `order_keys` then assumes a
missing component must be present and calls `expect("matched")`.

Reproduction: declare `t` with integer columns `a`, `b` and
`unique byAB: a, b`, then compile `return t[a=1, a=2]`.
`check --json` exits 101 with a panic at `bind/program.rs:977` instead of a
structured diagnostic. An ordinary authoring mistake becomes a compiler crash.

Reject duplicate named keys and report missing/excess components during index
selection. Replace the unchecked assumption with a diagnostic-preserving path.
Cover point reads, range prefixes and rule probes that share selection logic;
verify the diagnostic includes the source site and a usable rewrite and the
compiler can report other independent errors in the same invocation.

## Implementation locations

- [crates/snapback4-lang/src/bind/program.rs](../../snapback4/crates/snapback4-lang/src/bind/program.rs)

## Resolution — 2026-09-13

Duplicate named keys and mixed key forms are diagnosed before index selection/reordering. Point reads, ranges and rule probes produce located diagnostics rather than panicking.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
