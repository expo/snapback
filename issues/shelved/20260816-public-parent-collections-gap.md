# Public/persona-owned tables cannot adopt `assetCollection`

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Assets, Schema,
Demos

**Related:** LLP 0239 D2/D4 (+R5), issues/shelved/20260815-finish-media-happy-path.md

## What happened

The Phase D device-acceptance lane tried to upgrade
`demos/relay-room-bakeoff/snapback-expo` (and would have hit the same wall in
`demos/messaging-snapback`) to the landed `assetCollection` surface.
Generation refused with `SNAPBACK_MEDIA_COLLECTION_OWNER_TABLE_INELIGIBLE`:
both messaging demos model messages as deliberately public, persona-authored
rows with no owner principal and `assetSharing({ kind: 'public-read' })`.

The refusal is correct by v1 design — the generated operations' "parent
authority" checks need an owner-visible parent, and silently admitting public
parents would make append/replace authority ambient. But it means the entire
persona-demo/messaging-room app shape (a common real shape: public or
membership rooms) cannot adopt generated collections today.

## Wanted (design, not tonight)

One of, per an LLP 0239 amendment or the R5 rollout:

1. membership/authority-profile-derived parent authority for collections
   (this is roughly what R5's `LLP 0240` composition gate was reserved for);
2. a documented owner-principal pattern for room/persona apps (e.g. sender
   owns the message row) plus a guide note in backend/media-happy-paths.md;
3. an explicit ruling that public-parent collections stay refused and the
   diagnostic's remediation names the supported alternatives.

Until then, device/published-package media demos should use owner-principal
schemas (the media-profile fixture shape).
