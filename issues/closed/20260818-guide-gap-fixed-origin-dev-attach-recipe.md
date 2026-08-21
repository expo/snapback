# guide-gap: pinned-port / fixed-origin dev loop needs a first-class recipe

**Status:** Resolved 2026-08-21
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
regenerated artifacts without restarting the pinned server. The working
recipe exists (attach + ready-file + startup-carrier rewrite) but is
assembled from refusal texts, not documented as a path. Wanted: one guide
page (or `snapback dev` flag) covering pinned-port serve, attach semantics
vs `snapback start`, carrier rewrite on regenerate, and the supported way to
bind the Expo provider to an already-running fixed origin.

**Additional evidence, 2026-08-20/21:** diaries 0104 and 0105 reproduced the
same seam on current local main. The Explicit lane supplied a fixed Expo
command, but `snapback dev --expo` observed the expected dynamic Metro
listener as an incomplete enumeration and tore down the working fixed-port
pair with `SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`. The Familiar lane
again needed a managed-runtime port wrapper plus a separately owned Expo
server. This is now repeated across both profiles and two benchmark rounds.

## Resolution

Added `guide/recipes/fixed-origin-development.md` and linked it from the
authoring and React/Expo paths. It names the one-server ownership model,
ready-file/startup carrier, `dev --attach` hot-load loop, Vite attach mode,
Expo virtual binding, and the fixed-origin listener refusal. Retrieval case 59
uses the diary's exact fixed-origin, pinned-port, startup-carrier, attach, and
diagnostic vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/fixed-origin-development.md` passed in 9/15 tool
uses.

Closure evidence: `node scripts/check-retrieval-eval.mjs --check` (70 cases,
0 errors), `node scripts/check-guide.mjs` under Node 24 (19 passed, 0 failed),
and `node scripts/check-first-read.mjs --check` (5 profiles) all pass.
