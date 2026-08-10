# Multi-image authoring: img1..img4 column splay vs the bounded-array withdrawal — steer or re-rule (LLP 0208 G8 asset slice)

**Status:** Resolved 2026-08-10 — both closure conditions met.
**Resolution:** (1) The dated author re-ruling landed 2026-08-09 in LLP
0044's header (withdrawal-scope clarification: `v.array(v.assetRef(...))`
remains withdrawn, its clause binds the asset-reference vocabulary, and
plain-data structured values are governed by LLP 0211); multi-asset
relationships stay on the LLP 0110 bounded-children path. (2) The
steering half landed in `guide/backend/assets.md` §"Attach several
assets to one row (multi-image posts)": the page now answers the
pilot's exact question (a 1–4-image post) with the bounded-children
recipe anchored to the CI-validated Party Wall composition, so "no
arrays" reads as "use child rows," not "splay columns."
**Severity:** P3 (authoring ergonomics; the paved path exists but was not taken)
**Systems:** Assets, Schema, Codegen, Guide
**Date:** 2026-08-09
**Related:** LLP 0044 (2026-07-31 bounded-array withdrawal — author ruling),
LLP 0110 (bounded children — the ruled paved path), LLP 0007 (schema
vocabulary), LLP 0208 (pilot evidence, G8)

## Problem

Clique's 1–4-image posts became an `img1..img4` column splay: four identical
`v.optional(v.assetRef({ upload: 'postImageUpload' }))` declarations, four
`ctx.assets.attach` calls per mutation, and a client mapping picked files
onto positional arg names (`clique/snapback/schema.mjs`, `functions.mjs`,
`app/(tabs)/feed.tsx`). The pilot diary records this as the capability
index's steering ("no `v.array()` on stored fields → four img columns").

**Prior ruling, not to be silently re-litigated:** LLP 0044's 2026-07-31
dated decision (Charlie) withdrew `v.array(v.assetRef(...))` — multi-asset
relationships take the LLP 0110 bounded-children child-row path, validated
by the Party Wall demo. The pilot agent read the capability index, saw "no
arrays," and reached for column splay — **not** child rows. That is the
finding: the ruled paved path either wasn't discoverable at the point of
need or didn't present as fitting an ordered 1–4 image attachment.

Adjacent (same G8 register row, different owner): unique-index-on-optional
refusals forced required-with-generated-default workarounds for
clientKey/dmKey; that half belongs to the LLP 0004/0131 owners and is not
absorbed here.

## Ask

1. **Steering first (cheap, likely sufficient):** the guide's assets page
   and the capability index GAP row should answer "post with up to 4
   images" with the bounded-children recipe (ordered child rows +
   `assetSharing` via the parent), so "no arrays" reads as "use child
   rows," not "splay columns." LLP 0180's deferred multiple-assets
   extension (1–4 bound) is the command-side hook when commissioned.
2. **Re-rule only on evidence:** if the owner judges the child-row path
   genuinely worse for ordered small-N attachments (join for every read of
   a post row), present the pilot evidence to the author for a bounded-
   array revisit — as a new ruling request, not a default.

## Done when

- The guide/capability index steers multi-image authoring to a named,
  CI-verified bounded-children recipe, or
- A dated author re-ruling on bounded arrays is recorded in LLP 0044 (either
  outcome closes this), with LLP 0208 G8's asset half annotated.
