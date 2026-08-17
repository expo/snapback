# Coterie feed pagination stalls before a third page

**Opened:** 2026-08-17
**Source:** Coterie browser-media fix dual review (Grok Finding 1; latent
outside the current two-page fixture envelope)

## Gap

Coterie's heterogeneous feed correctly uses Exact's non-virtual host-fed
`list`, but that path mixes item counts with pixel geometry for reach-edge
calculation. The list runtime reports `totalSize: allItems.length` for a
non-virtual collection (`packages/exact-contract/src/runtime/view.ts:5768-5775`),
while `CollectionReachState` subtracts pixel `viewport` and `offset` values
from that total (`packages/exact-contract/src/runtime/collection-geometry.ts:137-145`).
The first real geometry sample therefore puts the collection immediately in
the end zone, fires `endreached`, and leaves the edge sticky instead of
re-arming after more rows arrive.

This remains latent in the current fixture: it has only two pages. Page 2 is
visible because the ready branch directly merges `olderPosts` into
`visibleFeedRows` (`demos/coterie/src/app/routes/index.contract:211-212`). A
third page would stall: the sticky edge does not invoke the next commit, and
the advancing reducer deliberately carries the successor cursor in
`inFlightCursor` (`demos/coterie/src/data/feed-pagination.ts:319-339`), so that
cursor never clears through the missing reach-edge transition. The binding
itself still exists on the real feed list
(`demos/coterie/src/ui/feed-list.contract:16`).

The related benchmark instrumentation gap also needs disposition: the shared
social-messenger choreography has no feed-scroll/pagination step, despite
brief acceptance item 8 requiring a second page in both tabs
(`benchmarks/briefs/social-messenger.md:475-476`).

## Resolution target

- Give non-virtual host-fed lists a pixel-compatible content extent (or an
  equivalent measured reach snapshot), then prove `endreached` leaves and
  re-enters its threshold as rows append.
- Add a Coterie regression with at least three pages in both feed tabs and
  verify no duplicates or gaps.
- Have the benchmark program explicitly add, defer, or replace the missing
  shared choreography step rather than treating its absence as acceptance
  evidence.
