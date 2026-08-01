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

---

**RESOLVED 2026-08-01 — author-ruled ("go ahead and make both of those
changes"), designed and implemented.** LLP 0044 §Ceremony floor and
bounded on-demand widths (dated amendment) + the 0007 companion note
carry the design. Implemented: bare `v.assetRef()` derives a generated
default intent (strict/strip/owner-only, `_assets.default.<table>.<field>`,
ordinary manifest identity, `defaults.<table>.<field>` api projection;
`upload: null` preserves unrestricted semantics — the conformance
fixture's deliberate case now spells it); `?width=N` on strict and
public delivery plus `widthPx` on signed issuance ladder-normalizes
(13 steps ≤ 2048, declared facts) and materializes once through the
ordinary publication machinery with authorization-before-materialization
probes. Tests: codegen derivation/null/strip-refusal cases; Rust ladder
unit + e2e (materialize-once, above-ceiling, foreign-caller
no-materialize, gate-off refusal). New minimal avatar ceremony: **one
schema field + one attach line** (was 3 files + 6 concepts; PocketBase's
zero-file bar remains ahead on account of codegen itself, recorded
honestly). Guide quickstart updated with the minimal path.
