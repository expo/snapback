# guide-gap: verify-config authoring contract only in source

**Status:** Closed
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Guide, Verify, CLI
**Date:** 2026-08-08
**Related:** Diary 0069 (run 5, 0.1.15)

Second consecutive run where a lane authored snapback.verify.config.mjs
by reading @expo/snapback-cli's verify.mjs (profile run-return shape,
identity context requirements, the bare `/verify` subpath import that the
exports map demands). guide/testing/verify.md should carry the authoring
contract with a CI-verified minimal profile.

## Resolution

Fixed 2026-08-08. `guide/testing/verify.md` now documents the dedicated
`@expo/snapback-cli/verify` import (while acknowledging the compatible package-
root re-export), relative-path rules, profile registration, runner inputs,
required target/data/authority/seed identities, and the complete D1 return
shape. Its two literal snippets come from a packaged, copyable minimal fixture.
The fixture deliberately reports `unsupported` provenance so it proves
authoring/identity plumbing without fabricating read/write coverage;
`verify.test.mjs` loads and executes it through the public exports map.
Retrieval-eval case 24 preserves the repeated source-reading miss without
rejecting the supported root import.

Verified with:

- `node packages/snapback-cli/verify.test.mjs` (`18 D2 cases passed`)
- `node packages/snapback-cli/package.test.mjs`
- `node scripts/check-inventories.mjs` (`237 package tests`, `281 publication leaves`, `244 snippets`)
- `node scripts/generate-guide-manifest.mjs`
- `node scripts/check-guide.mjs` (`64 pages`, `244 snippets`, `122 routes + 43 host-ops`; pass with 62 existing freshness warnings)
