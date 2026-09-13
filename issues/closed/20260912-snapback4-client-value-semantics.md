# Snapback 4: Preserve the server value model in client arithmetic, ordering and aggregate keys

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R16
Evidence: Overflow, Unicode comparison and real aggregate prediction reproduced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The TypeScript interpreter does not preserve several parts of the retained
value model. It performs unchecked JavaScript arithmetic, uses UTF-16 string
comparison in total ordering, and tags every string as `Id` when constructing
canonical aggregate identities. Negative-divisor `Divmod` also uses
`Math.floor` rather than the core's Euclidean operation.

Observed examples:

- i53 maximum plus one returns an unsafe integer instead of refusing overflow.
- U+10000 sorts before U+E000 locally, opposite the core/key order.
- Seed a maintained count grouped by text `category: 'g'`. A local insert
  creates a second aggregate row with id `[{"Id":"g"}]` alongside the
  confirmed `[{"String":"g"}]`, each with value 1 instead of one value 2.

Use type-aware canonicalization and checked numeric operations consistently,
including nested values, aggregate keys, sorting/merge/cursors and maintained
sums. Verify these examples by running the same supported programs on Rust and
the actual TypeScript interpreter. Add negative-divisor and boundary arithmetic
cases rather than only testing exported helper functions. LLP 3000.003 covers
whether tags or type context should own this contract internally.

## Implementation locations

- [packages/snapback4/src/replica/interpreter.ts](../../snapback4/packages/snapback4/src/replica/interpreter.ts)
- [packages/snapback4/src/replica/cursor.ts](../../snapback4/packages/snapback4/src/replica/cursor.ts)
- [crates/snapback4-core/src/value.rs](../../snapback4/crates/snapback4-core/src/value.rs)

## Resolution — 2026-09-13

The actual TypeScript interpreter uses checked i53 arithmetic/sums, Euclidean division, Unicode scalar ordering and type-aware aggregate identities. Cursor descriptors preserve Rust serde field order, and canonical tokens continue across hosts.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [crates/snapback4-lang/tests/value_parity.rs](../../snapback4/crates/snapback4-lang/tests/value_parity.rs)
