# tests/demo_setup_v0.mjs expected list is missing campfire and party-wall

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Severity:** P2
**Systems:** CI, Demos, Tests
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** —

`node tests/demo_setup_v0.mjs` fails on main: `discoverDemoSetups` finds 18
demos, but the hardcoded expected list in the test has 16. `demos/campfire`
and `demos/party-wall` landed without updating the list. Reproduced locally
on a clean checkout and observed on PR #9 run 30733786036 (the
`Verify Snapback local proof` step).

This blocks the whole local-proof lane, so nothing after this test in
`scripts/verify-local-proof` currently runs in CI.

On GitHub-hosted runners this was masked: main's local-proof died earlier
with `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT` (link probe over 300000 ms on the
2-core runner), so the proof never reached the test. On expo-large the link
succeeds and the real failure surfaced.

Exit: add the two demos to the expected list (they should provision through
one reset like the others), rerun `node tests/demo_setup_v0.mjs`, and let
local-proof proceed past it.

## Resolution — 2026-08-02

Added campfire and party-wall to the expected list. Root cause went deeper:
since 6e080ca2 the generated manifests the test provisions from are
gitignored, so the test can only run after `scripts/check-generated-artifacts`
materializes them on a clean checkout — moved it there in verify-local-proof.
party-wall was also missing from that regen gate; added, which refreshed its
committed review manifest. `scripts/check-generated-artifacts` then
`node tests/demo_setup_v0.mjs` pass locally (18 demos provision).
