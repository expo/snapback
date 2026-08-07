# Supervised Expo web carrier: bootstrap CORS, AppState deep-import, picker URI schemes

**Status:** Open
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
