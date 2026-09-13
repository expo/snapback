# Snapback 4: Reconcile live page boundaries when earlier pages change

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R29
Evidence: Reproduced using the built Pages implementation and controlled live observations
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`Pages` opens each later page with the previous cursor once, then concatenates
all live results forever. When the first page changes, later page cursors are
not rebound and overlap/gaps are not reconciled. The returned `read` comes
from the last page and can still report complete and fresh.

Reproduction with two-row pages: initially load `[a,b]` and `[c,d]` after cursor
`b`. Insert `z` before `a`: the first page becomes `[z,a]`, the second stays
`[c,d]`, and combined items are `[z,a,c,d]`, omitting `b`. Delete from the front
so the first page is `[b,c]`: combined items become `[b,c,c,d]`.

Define a live-page boundary policy and implement it consistently: rebind/reset
following pages when predecessor boundaries change, or maintain a coherent
range with equivalent semantics. Deduplication alone cannot repair omitted
rows. Cover insertion, deletion, reorder, an in-flight `loadMore`, and changes
to arguments; ensure completeness/freshness describe the combined result rather
than only its last component.

## Implementation locations

- [packages/snapback4/src/react.tsx](../snapback4/packages/snapback4/src/react.tsx)
