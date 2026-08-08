# guide-gap: SVG through the typed asset lifecycle has a safe adapter pattern the guide doesn't teach

**Opened:** 2026-08-08 · **Severity:** P3 (guide-gap)

The native trusted image detector intentionally treats active SVG as
opaque, so an app whose frozen accepted-image set includes
`image/svg+xml` cannot declare it on the ordinary image intent. The
Zerobugs control built the safe adapter (server-side exact MIME/length/
signature validation → separately named opaque native intent → typed
`v.assetRef` attach → delivery alias with `nosniff` + sandbox CSP;
`C-ASSET` in the control PLAN, live-verified in the Lane 5 receipts). The
guide should either teach this adapter as the recipe or name SVG an
explicit GAP so the next app doesn't rediscover it.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution — 2026-08-08 (absorbed; recipe taught)

Taken the "teach the adapter" fork rather than the GAP-row fork.
`guide/backend/assets.md` gained a section, *"SVG: why the image intent
refuses it, and the safe adapter"*, placed after Images/Video.

It opens with the diagnosis an author actually hits, which was the whole
discoverability problem — declaring `image/svg+xml` in `accept.mediaTypes` is
**admitted at attempt-create and refused at trusted finalization** with
`SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED`, because detection is byte-based
(`detect_content_type` in `src/assets.rs` has no SVG magic number, so SVG
bytes detect as `application/octet-stream` and `asset_media_type_admitted`
rejects them in `src/local.rs`). It then names the second mechanism —
`forces_attachment_disposition` keeps `image/svg+xml` off every inline
delivery lane, so a stored SVG cannot become a same-origin script lane — so
the reader understands the refusal as policy rather than a bug.

The `C-ASSET` adapter is then taught as four numbered steps, each with a
transclusion-verified snippet from the working control:

1. **Exact server-side validation before upload** — declared MIME vs declared
   length vs actual byte signature (`mimeMatches` in
   `demos/zerobugs/control/composition/server.mts`), with the honest caveat
   that a signature test is a shape test, not a safety proof, which is why
   step 4 is non-optional.
2. **A separately named opaque intent** — `zerobugsSvgUpload` accepting
   `application/octet-stream` with no `image` block, beside the unchanged
   four-type trusted image intent, plus the octet-stream-declared upload call
   so declared and detected types agree.
3. **Typed `v.assetRef` attach** — the explicit `v.assetRef({ upload: null })`
   spelling (the derived default intent cannot represent a two-intent alias)
   and the MIME↔intent re-assertion inside the attaching mutation.
4. **An app-owned delivery alias with `nosniff` + sandbox CSP** — the
   re-labelling that makes the sandbox headers mandatory, applied only to the
   SVG type.

It closes with an explicit is/is-not: an application adapter that keeps SVG
inside the typed asset lifecycle, **not** native SVG support (no renditions,
no `width=` ladder, no ThumbHash, no dimension/dominant-color facts, no
sanitizer; you own the validator and the headers), with the default advice to
rasterize to PNG absent a hard requirement.

Also landed:

- `guide/capabilities.md` `backend.assets` aliases gained `SVG` and
  `image/svg+xml` (grep vocabulary; the index previously had zero SVG
  strings, and the page had zero SVG mentions).
- `guide/retrieval-eval.md` seed case 20, whose failure conditions are
  widening the trusted detector, treating the refusal as a bug, or serving
  SVG through an alias without `nosniff` + sandbox CSP (LLP 0187 T7).
- `assets.md` frontmatter: `demos/zerobugs/control` added to `examples`, its
  `functions.mjs` and `composition/server.mts` to `authorities`.

Evidence honesty recorded on the page: the control's implementation is
witnessed by its own `test:lane5:live` route check
(`route-07-upload-five-types-server-policy-delivery-and-cleanup`) and the
retained ZB4/ZB7 receipts, **not** by repository CI. The snippets are
transclusion-verified, so control drift breaks
`node scripts/check-guide.mjs` — which is green at 63 pages / 236 snippets /
0 errors.
