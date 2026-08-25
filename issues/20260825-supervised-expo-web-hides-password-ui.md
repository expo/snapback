# Supervised Expo web omits `EXPO_PUBLIC_SNAPBACK_URL` and mints a session that hides password UI

**Filed:** 2026-08-25
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** React/Expo, Auth, CLI, Guide
**Owner:** LLP 0310.000 Track B

## Problem

`snapback dev --expo --expo-platform web` injects
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` and mints an ambient session. It
does not inject `EXPO_PUBLIC_SNAPBACK_URL`. Adopting the mint hid
`sm-auth-email`. Signing it out crashed the provider with
`SNAPBACK_AUTH_SESSION_EXPIRED`. The working landing was URL-first
`SnapbackProvider` using the supervisor bootstrap origin and ignoring the
minted bearer. That reconstructs LLP 0300 by hand. The familiar page does
not say so.

## Evidence

- Familiar diary M1 and essay
  (`benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-familiar/`)
- LLP 0310 F3 / P4

## Direction

Preferred: also inject `EXPO_PUBLIC_SNAPBACK_URL` so password signup/sign-in
work without adopting the mint. The mint stays an explicit opt-in
(LLP 0258 / 0262), not the default first session. A sign-out of a session
the author never created must not be the only path back to a login form.
