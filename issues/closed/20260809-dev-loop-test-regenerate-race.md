# sessions-dev-loop test: explicit generateApp races the watch loop's debounced regenerate

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** CLI, Testing
**Date:** 2026-08-09
**Related:** `packages/snapback-cli/sessions-dev-loop.test.mjs`,
`packages/snapback-codegen/index.mjs`,
`packages/snapback-codegen/review-surface.mjs` (`atomicReplaceDirectory`
rename window),
`issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md`

Found while verifying the successor-activation landing: the test calls
`generateApp` explicitly while the managed loop's `watch: true` debounced
regenerate can run against the same `generated/` directory; the
`replaceDirectory` rename window can produce a spurious `ok: false`
during an overlapping regeneration (observed once during iteration; the
previously committed test had the same shape; 5/5 green after the fixture
fix, so this is latent, not active). Structural fix candidates: serialize
regeneration through the loop's own scheduler in test mode, or have
`generateApp` take the same lock the watch regenerate uses.

## Resolution (2026-08-10)

Implemented the shared-lock shape at the codegen boundary. Every
`generateInProcess` writer for a canonical backend directory now acquires the
same dependency-free `.generated.regenerate.lock` before reading inputs and
holds it through cache and `generated/` publication. That covers the managed
watch pass, direct `generateApp`/`generate` calls, and separate processes
without changing the managed loop's debounce queue. The loop-scheduler shape
was rejected because it protects only callers routed through one loop handle;
the existing explicit call and other codegen processes do not possess that
scheduler.

The lock records PID and unique ownership, waits for a live holder with a
bounded fail-closed timeout, reclaims dead/malformed-old/bounded-age holders,
and removes only the caller's own lock. A deterministic regression test parks
one writer after `generated/` is renamed aside, overlaps a second writer, and
requires both `ok: true` plus a verified consistent final graph. With the lock
temporarily bypassed, that test reproduces the original `ENOTEMPTY` write
failure. A second test kills a holder with `SIGKILL` and proves the next
regeneration reclaims the stale lock within the bound.
