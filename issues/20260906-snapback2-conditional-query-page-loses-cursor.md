# Snapback 2: conditional page returns lose the continuation cursor

**Status:** Open
**Date:** 2026-09-06
**Systems:** Snapback 2 compiler, query certificates, engine, twin
**Source:** fresh Astra-medium Clique build on npm `snapback2@0.0.6`

The M2 builder's query selects Global or Following with `if global`, returning
a shaped page from either branch. With more than twenty rows, the response is
`capped`, returns twenty rows, and has `next: null`. Standalone plain ranges,
inline shapes, nested point shapes, and aliased pages preserve their cursors.
Splitting the conditional query into `globalFeed` and `followingFeed` restores
pagination; the browser then observes 20 → 40 → 43 entries.

Retained published-only evidence on the office M1:
`/Users/ccheever/clique-improvement/lanes/astra-snapback2-006/`, especially
`snapback/social.q` (`feed`, `globalFeed`, `followingFeed`), the
`evidence/m2-pagination-*` probes, and `diaries/run.md`. The benchmark app is
left unchanged by the product-fix lane.

Independent source inspection confirms the compiler intentionally drops page
provenance whenever it finds a conditional return:
`snapback2/packages/compiler/src/result-page.ts`, `resultPageSite` and its
`conditionalReturn` flag. This is a currently unsupported authored shape,
not a failure of nested point enrichment. Existing single-site page
certification under LLP 1011 §B1 explains the restriction; it does not make
the resulting paginated authoring experience complete.

## Resolution

Carry certified page provenance through conditional query returns so the
selected branch produces a continuation for its actual ordered page. Preserve
authorization, hidden-position exclusion, opaque-cursor validation, and the
engine/twin agreement on incomplete local coverage. Prove both branches over
at least two pages, including a range branch and a merge branch, and invalid
cross-branch cursor use. Update the existing LLP and page recipe with the
implemented behavior. Merely documenting the split-query workaround does not
resolve the requested product capability.
