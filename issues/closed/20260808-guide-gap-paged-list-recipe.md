# guide-gap: no pagination-UI recipe despite it being a recurring demo journey

**Opened:** 2026-08-08 · **Resolved:** 2026-08-08 · **Severity:** P3 (documentation)

Keyset pagination existed only as a backend fragment and generated pattern.
Nothing taught the client journey: a load-more/paged list over live queries
whose delivery is whole-result replacement, the unique continuation boundary,
and the difference between retained exact page registrations and a volatile
React archive.

## Resolution

- Added `guide/recipes/paged-list.md` with CI-transcluded backend, React, and
  acceptance source from the `media-feed` template.
- Repaired `packages/snapback-cli/templates/media-feed/` to page on a required,
  immutable, independently unique `pageKey` instead of non-unique
  `createdAt`.
- Strengthened the live acceptance with equal timestamps on opposite sides of
  the first/older boundary, a no-overlap assertion, and a newer interleaved
  insert that must not shift the historical page.
- Added shipped capability `clients.react-paged-list` and retrieval-eval case
  27.
- Documented the boundary honestly: opaque owner/membership cursor envelopes
  are callable through the headless client and are not surfaced by
  `useSnapbackQuery`.

No new platform API was needed for the public-feed recipe. A future first-class
React callable-page hook would be separate work, not a condition of this
documentation gap.
