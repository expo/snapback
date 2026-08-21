# guide-gap: pinned-port / fixed-origin dev loop needs a first-class recipe

**Status:** Closed 2026-08-21
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

Partial evidence: retrieval, Guide, and first-read checks pass. They prove the
route and generated corpus, not the missing packed vertical contract.

## Resolution — 2026-08-21

The docs-only 1C ruling closes the guide gap against today's shipped surface.
The recipe now distinguishes `snapback start` process ownership from
`snapback dev --attach --ready-file` generation/hot-load ownership, states
that `--no-watch` is the one-pass form, and records that attached regeneration
does not rewrite the Sessions startup carrier. It documents Vite attach and
the lower-level provider composition for a separately owned Expo/Metro
process, including the exact binding and listener-enumeration refusals from
diaries 0096/0100/0104/0105. It does not invent the pending fixed-port
`snapback dev` profile.

Retrieval case 59 now carries the diaries' exact plausible wrong vocabulary:
`snapback dev will not pin 42080`, `SNAPBACK_APP_BINDING_UNAVAILABLE`,
`OVERRIDE_UNCONFIRMED`, `AUTH_MODE_PENDING`, `STARTUP_ARTIFACT_MISMATCH`,
`SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`, and `managed-runtime port
wrapper`. The retained cold probe at
`guide/eval-runs/2026-08-21/fixed-origin-development.md` reached the page on
tool call 3 of 5; the static retrieval check was rerun after this correction.

LLP 0295 D0.1/W1 and
`issues/20260821-fixed-origin-external-client-dev-lifecycle.md` retain the
product work: one fixed-port/external-client lifecycle, owner-performed carrier
rewrite, admitted provider binding, and packed external vertical fixtures.
Those pending mechanisms are deliberately not claimed by this docs-only
closure.

Landing SHA: 2581f4e8f
