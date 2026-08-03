# guide-gap: shipped asset export-cut surface has no guide coverage

**Status:** Open
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
