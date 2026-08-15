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

## Resolution

Resolved 2026-08-15 by `2e0e5e03a`. The data-query guide and capability row
now route authors to a complete literal chain under the codegen backend root,
conventionally `snapback/data-queries.mjs`, and document `_id` as the totalizer
after an exact unique-index predicate. Both the generated builder and client
admission refusal name that scan boundary, regeneration, and generated-
descriptor repair. The exact served `/_snapback/guide/data/promotion.md` URL is
linked and pinned by the embedded-server route regression.

The refusal intentionally remains synchronous when `.take(...)` completes the
shape: without a catalogue witness there is no valid generated function
reference to issue, so delaying it would return a descriptor already known to
be invalid and move the repair away from the authored chain. Proof:
`packages/snapback-codegen/data-query.test.mjs` (including the new unique-index
totalizer and refusal-copy assertions),
`packages/snapback-client/data-client.test.mjs`, and
`tests/served_guide_v1.rs::index_and_individual_build_embedded_files_are_public_read_only`.
