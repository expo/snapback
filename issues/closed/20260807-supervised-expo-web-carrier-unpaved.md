# Supervised Expo web carrier: bootstrap CORS, AppState deep-import, picker URI schemes

**Status:** Closed — paved 2026-08-07; e2e receipt collected 2026-08-07 (diary 0068)
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Expo client, Server HTTP surface, Assets
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Three independent walls, each replicated by BOTH measurement lanes (bare
and skill-equipped), each hand-worked-around twice:

1. The supervised bootstrap exchange serves no CORS headers, so a browser
   origin cannot complete it — both lanes wrote loopback CORS proxies
   (plus `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` in one).
2. The provider deep-imports `react-native/Libraries/AppState`, which
   breaks react-native-web; the escape hatch
   (`createSupervisedExpoEnvironment({ appState })`) exists but is
   discoverable only from package source.
3. The packaged image-picker asset-source adapter accepts only
   `content://`/`ph://`/`file://` URIs; web picker `blob:` URIs hang the
   command in `preparing` (workaround: pass a real `File`).

Fix shape: pave or honestly fence the web carrier for the supervised flow
— CORS on the exchange (scoped like the TUS fix), web-safe AppState
resolution, and a browser-source branch in the picker adapter; or a guide
banner stating the supervised path is native-first and pointing web at the
non-supervised provider. Acceptance: an Expo-web app completes the
supervised loop with zero app-authored proxies/shims, or the guide says
plainly that it cannot.

## Resolution notes (2026-08-07)

All three walls PAVED on their merits (none fenced):

1. **Bootstrap CORS** — `startBootstrapExchange`
   (`packages/snapback-cli/expo-dev.mjs`) now serves scoped CORS: exact
   six-prefix loopback-origin admission
   (`admittedBrowserExchangeOrigin`, mirroring `loopback_origin` /
   `with_cors_headers` in `src/server.rs`), `Origin` echo + `Vary: Origin`
   on every response including the 503 refusal, and an `OPTIONS`
   preflight. Non-loopback origins are never echoed; the listener stays
   loopback-bound — origin admission remains the boundary. Coverage:
   `packages/snapback-cli/expo-bootstrap-exchange.test.mjs` (real server,
   admitted/unadmitted/preflight/refusal/404).
2. **AppState deep-import** — resolution moved behind the conditional
   `#app-state` subpath import (`packages/snapback-expo/app-state.mjs` /
   `.web.mjs` / `.native.mjs`, condition order browser → react-native →
   default): native keeps the deliberate deep import, web resolves
   `AppState` from `react-native-web`, other hosts refuse with the coded
   `SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED` instead of a module-not-found
   crash. The `createSupervisedExpoEnvironment({ appState })` /
   `resolveAppState` injection stays the override. Coverage in
   `provider.test.mjs` + `package.test.mjs` (imports-map shape).
3. **Picker `blob:`/File sources** — `asset-source.mjs` adds a browser
   branch: direct `File`/`Blob` passthrough, picker assets carrying a
   `file` member, and `blob:` URIs read via browser fetch (never
   `expo/fetch`, never the native file fallback). Native
   `content://`/`ph://`/`file://` behavior unchanged. Coverage in
   `asset-source.test.mjs`.

Guide: `guide/clients/react-expo.md` gains "Run the supervised loop on
Expo web"; `guide/capabilities.md` `clients.react-expo` row updated.

**Residue (why this stays open):** the paves are package-level-proven
only; the acceptance bar's end-to-end witness — a real Expo-web app
completing the supervised loop with zero app-authored shims — has no
retained receipt yet. Next measurement lane (diary 0066 "For the W1
ratchet") should drive Expo web through the supervised loop and retain
that receipt, then close this ticket.

## Closed — 2026-08-08

The paves shipped in 0.1.13 and the residue (an end-to-end Expo-web
receipt) was collected by diary 0068's measurement lanes: both web lanes
ran the supervised Expo loop on the web carrier from the published
packages with zero app-authored proxies or shims — bootstrap exchange,
AppState, and the picker path all first-try, including the full
picker-to-rendered-image proof and the offline cached-binding cold boot.
