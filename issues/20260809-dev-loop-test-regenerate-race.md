# sessions-dev-loop test: explicit generateApp races the watch loop's debounced regenerate

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** CLI, Testing
**Date:** 2026-08-09
**Related:** `packages/snapback-cli/sessions-dev-loop.test.mjs`,
`packages/snapback-codegen/index.mjs` (~12726, `replaceDirectory` rename
window), `issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md`

Found while verifying the successor-activation landing: the test calls
`generateApp` explicitly while the managed loop's `watch: true` debounced
regenerate can run against the same `generated/` directory; the
`replaceDirectory` rename window can produce a spurious `ok: false`
during an overlapping regeneration (observed once during iteration; the
previously committed test had the same shape; 5/5 green after the fixture
fix, so this is latent, not active). Structural fix candidates: serialize
regeneration through the loop's own scheduler in test mode, or have
`generateApp` take the same lock the watch regenerate uses.
