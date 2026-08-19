# guide-gap: pinned-port / fixed-origin dev loop needs a first-class recipe

**Status:** Open
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
