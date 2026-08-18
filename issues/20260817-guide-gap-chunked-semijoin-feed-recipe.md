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
multi-chunk path with an acceptance-only `actorChunkSize` argument. The
`feedEvents` normalization and cursor-ownership design also had no paved
analogue.

## Ask

Until LLP 0278 D3 ships a closed semi-join, add a guide recipe teaching the
chunked composition verbatim from `demos/coterie/snapback/` — chunking rule,
merge key requirements (immutable, totally ordered), cursor ownership, and
the multi-chunk acceptance technique. Link it from the paged-list page and
the capability index row for `in()` so the bound's refusal names the recipe.
