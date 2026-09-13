# Snapback 4: Do not infer complete absence from a truncated partition

Status: Open
Priority: P1
Observed: 2026-09-12
Review finding: R15
Evidence: Point-miss failure reproduced; scan variants code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

A point read from a synced table returns a complete miss even when a count
horizon omitted the requested row. Scan incompleteness is inferred from the
currently held row count and the selected index, which loses the evidence
needed after deletions or when scanning another index.

Reproduction: a table declares `last 2 by byId`; the device holds rows `y`
and `z`, while older row `old` exists outside the acquired horizon. A point
read for `old` returns `null, complete: true`. Alternate-index scans and a
previously truncated partition whose held count drops below two also need
coverage beyond the current count heuristic.

Record or conservatively derive acquisition coverage and use it for point
misses, scans and mutation prediction eligibility. Verify beyond-horizon reads,
empty/short partitions after deletion, and alternate indexes. This ticket does
not request exact eviction or backfill, which are deferred; returning honest
incompleteness is required even with acquisition-only horizons.

## Implementation locations

- [packages/snapback4/src/replica/interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts)
- [packages/snapback4/src/replica/replica.ts](../snapback4/packages/snapback4/src/replica/replica.ts)
