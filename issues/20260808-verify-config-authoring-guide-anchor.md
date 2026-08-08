# guide-gap: verify-config authoring contract only in source

**Status:** Open
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
