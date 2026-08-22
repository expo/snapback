# guide-gap: supervised Expo mint is one shared session across browser contexts

**Status:** Open
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

## R1 corroboration — 2026-08-22

LLP 0295's cold packed Expo probes reproduced the same starting condition: the
supervised provider adopted its convenience session before the required
password-entry journey. The green R1 path kept the shipped binding exchange,
declined only `resolveSupervisedAuthority`, assigned stable public
`storagePartition` values through the provider's application-client factory,
and then used ordinary password signup/sign-in. Both Explicit and Familiar
retained distinct sessions through additive schema activation and a later cold
provider boot after the binding TTL. No custom relay or binding middleware was
needed. The retained record is
`benchmarks/runs/2026-08-22-r1-cold-probes/record.md`.
