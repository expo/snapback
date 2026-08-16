# LLP 0234 G2 flip missed tests/fixtures/familiar-todo*: app-binding descriptor contract red on main

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Auth, Code generation, Testing, Familiar profile
**Date:** 2026-08-16

`packages/snapback-expo/app-binding.test.mjs` (descriptor authoring-profile
contract section) is red on main: it regenerates
`tests/fixtures/familiar-todo-explicit` and `tests/fixtures/familiar-todo`,
whose `todos` table declares no visibility, and the LLP 0234 G2 enforcing
flip (`7264b4008`) now refuses generation with
`SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT` (schema.mjs:8, `todos`).

Baseline-proven inherited: reproduced with origin/main's own
`packages/snapback-codegen` and byte-identical fixtures/test file (no LLP
0258 Phase 3 delta involved).

Fix-forward for the 0234 lane: extend the G1 corpus closure to these two
fixtures with the honest policy for their synthetic rows (the G2 diagnostic
itself warns against reflexive `public-read`; the fixtures have no owner
field today, so the 0234 owner should pick the intended shape), then re-run
`packages/snapback-expo/app-binding.test.mjs`.
