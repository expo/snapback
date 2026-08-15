# guide-gap: explicit-profile lane never found the asset pipeline and shipped data-URL media

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-explicit` vs
`sol-snapback-simplified` (0.1.21) · **Systems:** Assets, Guide

## Problem

The explicit lane persisted all fixture media (avatars, post images, video)
as data URLs inside Snapback records, recording that "the reduced Snapback
surface did not supply a production upload path." But the simplified lane —
running the same explicit profile and the same 0.1.21 closure on the same
machine — used the canonical asset intent/finalization flow for real image
and MP4 admission, guided by "the served auth and assets pages."

So the capability exists and works; one competent agent simply never
discovered it from the explicit-lane documentation set. That is a
discoverability failure worth treating as data: the asset surface needs to
be unmissable from the explicit authoring path (schema/functions pages
should point at it wherever a field could hold media), not only from its
own guide page.

## Evidence

- `lanes/sol-snapback-explicit/diary.md` M2 + `final-report.md` ("Media
  fallback: persist the reduced-run fixture media as data URLs").
- `lanes/sol-snapback-simplified/diary.md` M1/M2 (asset intent/command
  flow used successfully; "the served auth and assets pages gave concrete
  lifecycle language and prevented a custom auth or upload path").

## Suggested fix

Cross-link assets from the explicit schema and functions guide pages and
the capability index at the "storing media" intent; consider a codegen or
dev-time hint when a declared field's content looks like data-URL media.
