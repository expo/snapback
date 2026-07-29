# Guide gap: anonymous public reads in sessions mode lack a paved client path

**Status:** Open
**Area:** Guide, Sessions auth, Public queries, Headless client
**Found by:** LLP 0102 Partiful/Snapback deep-round arm
**Date:** 2026-07-28
**Governing:** LLP 0039, LLP 0057, LLP 0059, LLP 0061, LLP 0102

## Problem

The Partiful arm needed an anonymous public-event preview alongside
session-protected controls. A plain `SnapbackClient` query was refused with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` because it did not offer auth-client
protocol v1. Constructing a protocol-bearing client was also refused because
the v1 profile requires browser, agent, or external-bearer custody.

The working path was a hand-written HTTP query carrying the protocol header
while omitting a caller-selected auth body. Neither the headless client nor the
Guide exposed a first-class anonymous/public construction for a sessions-mode
application.

## Suggested resolution

- Provide a supported anonymous/public generated-client constructor for
  sessions-mode apps, or document the exact existing path.
- Add a public-preview-plus-protected-controls example.
- Make the refusal diagnostic point to a construction that custody policy will
  actually admit.

## Evidence

- `demos/backend-bakeoff/arms/partiful/snapback/work/tests/acceptance.mjs`
  (`anonymousQuery`)
- `demos/backend-bakeoff/arms/partiful/snapback/evidence/failed-attempts.md`
- `diaries/0030-partiful-backend-bakeoff.diary.md`

## Acceptance

- a CI-verified sessions-mode demo performs an anonymous public query and an
  authenticated protected query through paved client APIs;
- `guide/auth/sessions-and-principals.md` and `guide/clients/headless.md` link
  that example; and
- no caller-selected identity can be smuggled through the anonymous path.
