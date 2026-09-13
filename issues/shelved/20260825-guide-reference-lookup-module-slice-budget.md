# Guide reference lookup module slice exceeds its byte budget

**Filed:** 2026-08-25
**Systems:** CLI, Guide, generated symbol registry

## Problem

`node packages/snapback-cli/reference-lookup.test.mjs` exits before later
assertions because the inherited `@expo/snapback-client` module lookup exceeds
the 16 KiB result budget:

`SNAPBACK_GUIDE_LOOKUP_BUDGET_EXCEEDED: module slice @expo/snapback-client exceeds 16384 bytes`

The focused diagnostic-anchor regression now runs independently, so this red no
longer masks `SNAPBACK_AUTH_STALE_RESULT` routing coverage. Repair the module
slice shape or page sizing without raising the public lookup budget.
