# guide-gap: shipped asset export-cut surface has no guide coverage

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Assets, CLI
**Found by:** 2026-08-03 guide triage pass (backend feature page verification)
**Date:** 2026-08-03
**Governing:** LLP 0061, LLP 0044

## Problem

The consistent-cut asset export surface ships (capability manifest `export`
block with `export.cutExport: true`; `snapback assets export-cut` and
`snapback assets rotate-signing-key` CLI commands), but neither
`guide/backend/assets.md` nor the capability index teaches or witnesses it.
The assets page's Evidence section was corrected in the triage pass to stop
listing byte-backup facts wrongly, but the positive export-cut surface
remains undocumented — an author can only find it from the CLI help or
source.

## Suggested resolution

Add an export/backup section to `guide/backend/assets.md` (or a row/alias in
`guide/capabilities.md` under the deploy/backup family if that is the better
owner) covering `assets export-cut` capture semantics, the refuse-partial
behavior, and `assets rotate-signing-key`, with a CI-exercised witness.

## Resolution

Resolved 2026-08-04. `guide/backend/assets.md` now teaches the local logical
asset cut, its pinned capture set and explicit exclusions, manifest-last
all-or-nothing export posture, refuse-partial `import-cut` validation,
experimental restore boundary, byte-backup nonclaim, and instance-wide
signing-key rotation. The existing `backend.assets` capability row owns the
surface because this is the asset component of a logical export, not the
target-level deploy/backup planner; its aliases and witness now name the
export block and CLI operations.

`tests/acceptance/asset-conformance-v1.mjs`, already required by
`scripts/verify-local-proof`, now drives the native `export-cut`, `import-cut`,
and `rotate-signing-key` commands against a real server. It binds the exported
summary to the written manifest, observes an outstanding signed URL fail after
rotation, removes a copied blob, and asserts the CLI's non-zero structured
`SNAPBACK_ASSET_IMPORT_INCOMPLETE` refusal. The regenerated guide manifest and
flat projection pass `node scripts/check-guide.mjs`; `./ref-check --verbose`
passes with the new witness references.
