# Investigate the ceremony floor and thumbs-on-demand (PocketBase steals)

**Status:** OPEN — investigation ticket from the LLP 0139 bakeoff; an
author-facing proposal, NOT a silent reversal of decided 0044 positions

Two measured Snapback DX losses (diary 0048-upload-bakeoff-faceplate,
App A wrap; summary.md ceremony + media-pipeline + delivery axes):

1. **Ceremony floor.** PocketBase served an avatar with ZERO authored
   backend files (file field on the built-in users collection) against
   Snapback's 3 files + codegen + 6 concepts. Convex's three-step path
   is also lighter for the simplest cases. Investigate what a
   minimal-ceremony avatar path could look like without weakening the
   generated-facts model — e.g. a schema-level `v.assetRef` field
   implying a default intent (strict, strip, sane bounds) so the
   simplest case needs no separate defineAssetUpload; the intent stays
   the explicit escalation path.

2. **Thumbs-on-demand.** PocketBase's `?thumb=100x100` URL parameter
   (measured EXIF-dropping re-encode, no declaration anywhere) has no
   Snapback equivalent; 0044 §Non-goals explicitly deferred the dynamic
   `?w=` transform endpoint as a cache/CDN product in disguise, and
   v1 shipped pre-materialized declared variants. The bakeoff supplies
   the evidence the deferral said to wait for: the best media-DX moment
   in the field was exactly this feature. The proposal to evaluate:
   bounded on-demand variants WITHIN the declared-variant vocabulary
   (e.g. serve any width ≤ a declared ceiling from the nearest
   pre-materialized variant, or admit a small declared set of on-demand
   widths with the existing decode ceilings + cache-by-rendition-id) —
   keeping 0044's honesty about what is cached where.

Both halves change decided design (LLP 0044 is Accepted) — the outcome
of this investigation is a proposed dated amendment for the author, with
this bakeoff's measurements as the evidence base. Neither is a defect.

Evidence: diaries/0048-upload-bakeoff-faceplate.diary.md (pocketbase
arm + App A wrap); demos/upload-bakeoff/reports/summary.md.
