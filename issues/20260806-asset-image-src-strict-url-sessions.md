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
