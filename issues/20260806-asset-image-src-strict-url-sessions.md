# useSnapbackAssetImage.src defaults to a strict-delivery URL a plain <img> cannot fetch

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Assets, React client, Guide
**Date:** 2026-08-06
**Related:** Diary 0065 (loop 7); LLP 0044

## Problem

On a sessions-mode server, `useSnapbackAssetImage.src` returns the
strict-delivery URL, which requires a protocol header a bare `<img>`
cannot send — rendering empty image bubbles with no diagnostic. The
working answer (public-immutable delivery URL, plus retrying around the
rendition-publication race) was discovered by reading published package
source, not the guide.

## Fix shape

Either default `src` to the most-permissive delivery the asset's policy
allows (public-immutable when granted), or expose both URLs with clear
naming and document the `<img>`-compatibility rule plus the rendition
race in the assets guide page. Acceptance: the guide's Expo recipe
renders an uploaded image in a plain `<img>`/`<Image>` without the author
reading package source.

## Resolution (2026-08-07) — fix on main, closes at next publish (0.1.12)

Both halves of the fix shape landed in `@expo/snapback-react`
(`packages/snapback-react/index.mjs` / `index.d.mts`):

- **`src` is now the most-permissive delivery URL the asset's policy
  actually grants**: the pasteable `/assets/public/{id}/{variant}` URL
  whenever the intent declares `public-immutable` and any rendition is
  ready (including width-less renditions, which previously fell through
  to strict), the strict route only when nothing more permissive exists.
  URL selection only — delivery policy and server authorization are
  unchanged.
- **Both URLs are exposed under unambiguous names**: `src` plus a new
  `strictSrc` (always the header-authorized
  `/assets/records/{id}/bytes/best` route once the record is ready) and a
  `delivery: 'pending' | 'public' | 'strict'` fact.
- **The rendition-publication race is held in the hook**: a ready
  public-immutable asset with no ready rendition reports
  `delivery: 'pending'` and keeps the preview/placeholder underlay
  instead of emitting the unfetchable strict URL; the live record
  projection flips it to the public URL when the rendition publishes —
  no `onError` retry loop.
- **Discoverable diagnostic**: when only the strict URL exists on a
  sessions-mode server, the hook warns once per asset with
  `SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS` (empty-pixels
  explanation plus both fixes). Dev-mode servers, where strict URLs are
  plain-`<img>` fetchable, never warn.
- **Guide**: `guide/backend/assets.md` gained "Render the uploaded image
  in a plain `<Image>`" (transcluded fixture snippet, URL-selection rule,
  race, diagnostic; unreleased-fenced at 0.1.12), `clients/react-expo.md`
  points at it from the ImagePicker recipe, the capability index gained
  the grep aliases, and retrieval-eval seed case 9 pins the miss.
- Tests: `packages/snapback-react/assets.test.mjs` covers public vs
  strict selection, the pending race (preview and no-underlay), width-less
  renditions, and the warn-once/dev-silence matrix;
  `asset-upload-types.fixture.ts` strict-typechecks the new surface.

The published 0.1.11 closure still has the old behavior (the bakeoff's
evidence); keep this ticket open until the 0.1.12 publish, then move to
`issues/closed/`.
