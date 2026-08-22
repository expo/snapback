# guide-gap: chunked `in()` semi-join recipe for membership feeds

**Opened:** 2026-08-17
**Source:** Coterie Snapback M2 backend lane (Diary 0086); LLP 0277 F3;
LLP 0278 D3

## Gap

The builder `in()` bound (500 operands) refuses membership-driven feeds for
users following ≥500 actors, and the guide's paged-list recipe covers only
one ordered table. The Coterie backend had to design from first principles:
chunk actor IDs at ≤499 (the cursor takes the 500th binding), run an indexed
top-20 read per chunk, merge by the immutable `pageKey`, and prove the
multi-chunk path. The first implementation used a caller-visible
`actorChunkSize` argument; review required a separate fixed-size acceptance
query so the production feed exposes no cost-amplification knob. The
`feedEvents` normalization and cursor-ownership design also had no paved
analogue.

## Ask

Until LLP 0278 D3 ships a closed semi-join, add a guide recipe teaching the
chunked composition verbatim from `demos/coterie/snapback/` — chunking rule,
merge key requirements (immutable, totally ordered), cursor ownership, and
the multi-chunk acceptance technique. Link it from the paged-list page and
the capability index row for `in()` so the bound's refusal names the recipe.

## Resolution (2026-08-21)

Added `guide/recipes/chunked-semijoin-feed.md` with byte-exact, verified
transclusions from the Coterie schema, functions, cursor walk, and multi-chunk
acceptance. The recipe teaches the 500-binding ceiling and ≤499 actor chunks,
indexed top-N reads per chunk, exact merge by immutable totally ordered
`pageKey`, one global cursor owner, and a separate fixed-size acceptance query.
It explicitly preserves LLP 0278 D3 as design-only.

Review correction (2026-08-21): the final recipe states the `public-read`
prerequisite behind the 499 calculation, reserves host visibility bindings
for protected tables, admits at most 1,024 follow edges, and replaces the
caller-selected seam with `followingFeedAcceptance`. Acceptance now walks two
forced-multi-chunk pages and compares the complete sequence with an
independently filtered global feed.

Linked the composition from `guide/recipes/paged-list.md` and the query-bound
section, added the `backend.query-in-chunking` capability row with the diary's
wrong vocabulary, and added retrieval-eval cases 88–89. Regenerated the
diagnostic registry so `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED` points first to the
recipe, then regenerated the Guide manifest and flat projections.

Landing SHA: TBD
