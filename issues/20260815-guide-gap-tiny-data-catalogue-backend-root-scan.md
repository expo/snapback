# guide-gap: tiny-data static catalogue scans only the backend source root; app-level descriptors crash at route render

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-simplified` (0.1.21) ·
**Systems:** Tiny data (LLP 0254/0255), Guide

## Problem

The tiny-data static query catalogue only scans the backend source root.
A literal query shape authored at app level (the natural place to write it,
next to the screen that uses it) produced a synchronous
`SNAPBACK_DATA_QUERY_NOT_CATALOGUED` route crash. Nothing in app-level
usage or the served data pages made the backend-root scan boundary
discoverable; the lane found it by reading package source, then created
`snapback/data-queries.mjs` as the catalogue source.

Two pieces:

1. **Guide:** the data pages should state where catalogued query shapes
   must live and show the `data-queries.mjs` pattern; the refusal message
   should name the scan root and the fix.
2. **DX:** consider whether the crash should be a typed refusal at query
   issue time (with the guidance inline) rather than a synchronous route
   crash during render.

Secondary doc finding from the same lane: the served `data/promotion.md`
link 404'd (content existed on the served data resources page), and the
`_id` totalizer rule after an exact unique-index predicate was only
discoverable from package source.

## Evidence

- `lanes/sol-snapback-simplified/diary.md` M1 ("Documentation and
  workarounds") and `final-report.md` tooling loop (promotion.md 404).

## Suggested fix

Guide page + capability-index touch for the catalogue location rule;
refusal text that names the scan root; fix the served promotion.md route.
