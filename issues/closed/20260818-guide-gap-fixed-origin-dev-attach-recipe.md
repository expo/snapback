# guide-gap: pinned-port / fixed-origin dev loop needs a first-class recipe

**Status:** Closed
**Closed:** 2026-08-21
**Systems:** Guide, CLI dev loop, Expo client
**Date:** 2026-08-18
**Evidence:** diaries 0092 (hand-built fixed-origin Expo binding), 0096
(`snapback dev` won't pin a port; `SnapbackExpoProvider` rejects a raw
binding override with SNAPBACK_APP_BINDING_UNAVAILABLE/OVERRIDE_UNCONFIRMED;
Expo `--localhost` bound IPv6-only), 0100 (two typed refusals —
AUTH_MODE_PENDING, STARTUP_ARTIFACT_MISMATCH — before discovering the
`snapback dev --attach --ready-file --no-watch` hot-load loop).

All three independent matrix lanes fought the same seam: run a Snapback
backend on a FIXED port with an Expo/web client bound to it, and hot-load
regenerated artifacts without restarting the pinned server. The attach +
ready-file route was assembled from refusal texts rather than documented as a
path, and the original report incorrectly inferred that attach regeneration
rewrote the startup carrier. Wanted: one guide page (or `snapback dev` flag)
covering pinned-port serve, attach semantics versus `snapback start`, the
managed-only carrier refresh boundary, and the supported way to bind the Expo
provider to an already-running fixed origin.

**Additional evidence, 2026-08-20/21:** diaries 0104 and 0105 reproduced the
same seam on current local main. The Explicit lane supplied a fixed Expo
command, but `snapback dev --expo` observed the expected dynamic Metro
listener as an incomplete enumeration and tore down the working fixed-port
pair with `SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`. The Familiar lane
again needed a managed-runtime port wrapper plus a separately owned Expo
server. This is now repeated across both profiles and two benchmark rounds.

## Reopening note — 2026-08-21

The original page falsely claimed attached regeneration rewrote
`startup-artifacts.json`; the CLI only refreshes that carrier on managed
start/restart/reset paths. The page and retrieval regression now state that
boundary. The ticket also lacked LLP 0295's packed-external vertical contract
fixture, so its original exit and closure claim remain unmet.

## Partial implementation

Added `guide/recipes/fixed-origin-development.md` and linked it from the
authoring and React/Expo paths. It names the one-server ownership model,
ready-file/startup carrier, `dev --attach` hot-load loop, Vite attach mode,
Expo virtual binding, and the fixed-origin listener refusal. Retrieval case 59
uses the diary's exact fixed-origin, pinned-port, startup-carrier, attach, and
diagnostic vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/fixed-origin-development.md` passed in 9/15 tool
uses.

The initial retrieval, Guide, and first-read checks prove the route and
generated corpus. The W1 packed closure below supplies the external vertical
contract that was originally missing.

## W1 implementation update — 2026-08-21

The guide now teaches the first-party fixed profile of `snapback dev`:
`--port <backend-port> --external-client-origin <exact-origin>`. It no longer
asks authors to compose `snapback start --startup-artifacts` with an attached
loader, and it records that lifecycle-owned regeneration rewrites the sessions
startup carrier before hot-load. The page also explains the authoritative
application-ready receipt, receipt-verified idempotent attach, owned-child-only
shutdown, Vite's receipt binding projection, and the typed stale/wrong-binding
refusals. Raw `start --startup-artifacts` is retained only as a diagnostic and
acceptance-harness primitive.

## Resolution — 2026-08-21

LLP 0295 W1's packed external fixture now installs materialized CLI, client,
Expo, and Vite packages and proves receipt-bound headless, real-Vite, and
Expo-provider M1→M2 continuity. The Vite arm uses the actual plugin and actual
browser origin; the Expo arm proves the three Metro loopback aliases against
the Rust server's CORS admission and re-attaches after the separate Expo
projection without Expo writing the application-ready file. The recipe's
freshness digest and generated Guide projections were refreshed against those
authorities. Evidence:

- `packages/snapback-cli/packed-dev-lifecycle.test.mjs`
- `packages/snapback-cli/expo-dev-loop.test.mjs`
- `packages/snapback-vite/package.test.mjs`
