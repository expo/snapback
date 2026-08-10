# Docs generator: first-class --base path support

**Status:** Resolved 2026-08-10 · **Impact:** 2 · **Urgency:** 2 · **Ease:** 3
**Systems:** Documentation, Publishing
**Date:** 2026-08-08
**Related:** LLP 0195, website/scripts/assemble-docs.mjs

The website mounts the docs projection under /guide/ by post-processing
root-relative links (regex rewrite in website/scripts/assemble-docs.mjs).
It works, but the generator's own deterministic link checker validates
the pre-rewrite artifact, not what actually serves. Add a --base <path>
option to scripts/generate-docs-site.mjs that emits and checks the
rebased links natively, then delete the rewrite half of assemble-docs.

## Resolution — 2026-08-10

`scripts/generate-docs-site.mjs` takes `--base <path>`: pages, navigation,
assets, authored root-relative links, `llms.txt`, and manifest corpus URLs
emit at the base, and the internal validator strips only the configured base
and rejects escapes. Preview serving understands the base.
`website/scripts/assemble-docs.mjs` now requests `/guide/` and its regex
rewrite pass is deleted. Verified both modes green (115 pages, 17,610
internal links/assets, 913 stable anchors) after repairing the pre-existing
manifest drift (landed separately) and the broken
`guide/backend/assets.md` self-link anchor (fixed in this landing).
