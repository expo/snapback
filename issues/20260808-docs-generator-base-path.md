# Docs generator: first-class --base path support

**Status:** Open · **Impact:** 2 · **Urgency:** 2 · **Ease:** 3
**Systems:** Documentation, Publishing
**Date:** 2026-08-08
**Related:** LLP 0195, website/scripts/assemble-docs.mjs

The website mounts the docs projection under /guide/ by post-processing
root-relative links (regex rewrite in website/scripts/assemble-docs.mjs).
It works, but the generator's own deterministic link checker validates
the pre-rewrite artifact, not what actually serves. Add a --base <path>
option to scripts/generate-docs-site.mjs that emits and checks the
rebased links natively, then delete the rewrite half of assemble-docs.
