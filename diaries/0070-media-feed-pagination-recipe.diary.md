# Diary 0070: Media-feed pagination recipe

**Date:** 2026-08-08
**App:** `packages/snapback-cli/templates/media-feed`
**Scope:** stable load-more pagination plus Guide extraction

## What changed

The media-feed template already looked like the natural infinite-scroll
carrier: one live current window, one argument-keyed older page, a `FlatList`
`onEndReached` control, retained-query registration, and a local archive. The
implementation nevertheless used `createdAt` as the strict boundary. The
authored seed made every timestamp unique, so the acceptance could not expose
the defect.

The template now stores a required `pageKey`, declares it unique, and orders
and filters both pages on that field. New rows combine zero-padded trusted
server time with `ctx.runtime.id()`: chronological enough for the feed and
independently unique when two writes share a millisecond. `createdAt` remains
display data. The seed deliberately gives the last row of page one and first
row of page two the same timestamp, and the live acceptance inserts a newer row
between observations before proving the historical page is unchanged.

The new Guide recipe transcludes the template rather than inventing a second
fixture. It also names the subtle custody split the source alone does not:
retaining an exact `(query, args)` page does not persist the React `archive`
that assembles the infinite list.

## What felt good

- The existing `defineLiveQuery` + `ltFilter` + `useSnapbackQuery(skip)` surface
  was enough. No runtime or React API change was necessary for a public feed.
- Generated types made the boundary migration from integer to string flow
  through the hook and row type without casts.
- Whole-result replacement and canonical `_id` deduplication fit ordinary
  React state; the implementation is recognizable to someone coming from
  Convex or Supabase cursor pagination.
- The template and its registered proof command gave the recipe a stronger
  home than a prose-only fragment.

## What felt bad or surprising

- A visually correct twelve-row seed concealed a keyset correctness bug. A
  pagination acceptance that never puts duplicate natural sort values across a
  boundary is too weak.
- "Retained infinite scroll" was easy to overstate. Snapback can retain exact
  eligible registrations, but the assembled archive is app-owned volatile
  presentation state. Reload/offline completeness needs a different product
  design.
- The standard-pattern opaque cursor cannot be threaded through
  `useSnapbackQuery`: the result is an envelope rather than the hook's array
  result, and membership pages are callable-only. The Guide must split that
  path instead of making the public raw-boundary example look universal.

## Comparison

Convex and Supabase apps commonly build the same current-window-plus-archive
shape, so the React code itself is unsurprising. Snapback's useful difference
is that query retainability and current/retained freshness are explicit. The
cost is a sharper distinction between a retained query registration and the
application's accumulated list, plus a separate opaque-cursor custody model
for protected standard-pattern pages.

## Result and follow-up

The public-feed recipe is complete without a new first-class API. A future
React callable-page hook could make opaque owner/membership cursor envelopes
more ergonomic, but it is not necessary to ship or teach this template. The
former guide-gap ticket is closed with the executable carrier and regression
evidence.
