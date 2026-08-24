# guide-gap: supervised Expo mint is one shared session across browser contexts

**Status:** Closed
**Closed:** 2026-08-24
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Auth, React/Expo
**Date:** 2026-08-22
**Governing:** LLP 0258; LLP 0061
**Evidence:** Diary 0106 M1; Clique local-main Grok Explicit on
`b70caf19ea`

## Problem

`snapback dev --expo` can mint a supervised ordinary session
(`snapback-dev@localhost.invalid`). Adopting it makes every browser tab
the same principal. Clique’s two-client choreography then sees Alice’s
actions as Bob’s (and the reverse) until the app skips
`resolveSupervisedAuthority` / treats the mint as unavailable.

Headless Node multi-persona `storagePartition` is already a known sharp
edge (2026-08-20 local-main record). This is the **web** form: two
Playwright contexts against one supervised Expo origin share the mint.

The expo-chat start packet does not say that supervised authority is
process-global at the origin and must be skipped for multi-account UI
proof.

## Required change

- In the expo-chat start packet and the sessions/auth Expo page, state
  that the supervised mint is one session per origin and is wrong for
  two-user browser tests.
- Show the skip: `resolveSupervisedAuthority` returning unavailable, then
  real password signup/login per context.
- Cross-link the headless `storagePartition` rule so both multi-persona
  surfaces sit on one page.

## Acceptance

- A cold agent building a two-browser live-profile check does not have to
  discover the mint by watching Alice’s edits appear as Bob.

## R1 scope correction — 2026-08-22

LLP 0295's cold packed Expo probes did **not** reproduce the reported default
adoption behavior. They overrode `resolveSupervisedAuthority` to unavailable
before provider boot, then used ordinary password signup/sign-in through two
stable public `storagePartition` values. Both clients authenticated as the
same principal and held distinct sessions; this was not an Alice/Bob or other
distinct-principal proof. Explicit and Familiar retained those same-principal
sessions through additive schema activation and a later cold provider boot
after the binding TTL. The shipped binding exchange remained in use and no
custom relay or binding middleware was needed. This R1 run exercises the
proposed skip recipe only; the ticket's default-adoption/two-browser claim
continues to rest on the earlier Diary/Clique evidence. The retained record is
`benchmarks/runs/2026-08-22-r1-cold-probes/record.md`.

## Resolution — 2026-08-24

Implemented LLP 0300–0302 close the ask by making URL-first, two-process
development canonical. Plain `snapback dev` mints no ambient app session;
each browser context uses ordinary signup/sign-in and therefore can hold a
distinct principal. `snapback auth dev-session` is explicit and is never
template-consumed. The `expo-chat` start packet now states the separate-context
rule, and `guide/clients/react-expo.md` records both the supervised shared-mint
footgun and the URL-first escape. The optional supervised path remains
supported for lanes that deliberately want its lifecycle conveniences.
