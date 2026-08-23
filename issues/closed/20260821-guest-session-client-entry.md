# Add first-party guest-session entry to the application client

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** Auth, Identity, Client integration, React/Expo, Guide, Testing
**Date:** 2026-08-21
**Governing:** LLP 0214 §§2.8, 8.1, 11; LLP 0258 D1/D2/D9
**Evidence:** Messtimate published-0.1.24 diary
**Owner ruling:** 2026-08-22 — implement the declared guest-creation
transition (the `implement` option, not `server-design-only`).

## Problem

`defineAuth` and the shipped `expo-chat` template can declare and enable a
guest mechanism and `guestPolicy`, while the generated client lifecycle
explicitly classifies guest as `excluded-guest-principal-is-not-entry`. There
is no first-party browser/native entry such as `auth.enterAsGuest()`, and the
server surface does not currently expose LLP 0214 §8.1's public guest-creation
transition through the ordinary application client.

The result is a sharp contract split: the schema says an app supports guests,
but a browser cannot obtain that guest session without a development supervisor
or app-owned identity/broker work. This blocks capture links, try-before-signup,
anonymous drafts, and claim-later flows that the declared policy appears to
support.

## Required design and implementation

- Implement the LLP 0214 §8.1 transition through the ordinary auth route and
  framework-neutral client, gated by the generated `guestPolicy` and required
  effect budgets.
- Project one React/Expo entry surface over the same owner (for example
  `auth.enterAsGuest()` plus a hook only if hook state materially helps).
- Adopt the returned session through LLP 0258's existing coordinator and
  custody rules; do not create an Expo-only auth owner.
- Preserve disabled-policy, budget, CSPRNG, cleanup-contract, reaping, claim,
  logout, and authority-transition semantics.
- Reconcile the client-lifecycle row that currently excludes guest entry and
  make template/start-packet claims match the shipped route.

## Acceptance

- A packed browser and Expo scaffold with `guestPolicy.enabled: true` can enter
  as a guest, perform an authenticated operation, cold-restart under the
  declared custody grade, and claim or log out.
- Disabled policy, exhausted budgets, malformed input, unsupported custody,
  reaped guest, and claim collision fail with stable non-enumerating codes.
- No caller supplies a principal id, session id, expiry, or cleanup policy.
- The same transition owner serves framework-neutral, React, and Expo clients.

## Resolution

Implemented the owner-approved transition as the public, empty-body
`POST /auth/guest` route and the framework-neutral
`auth.enterAsGuest()` facade. Generated policy admits the transition only for
the complete enabled guest-policy/mechanism pair. The server owns CSPRNG
principal, session, bearer, expiry, and cleanup facts and atomically charges
the finite `auth.guest.create` and `auth.session-mint` successful-effect
budgets with the principal/session commit.

The returned session is adopted by LLP 0258's existing auth coordinator and
custody store. React and Expo project that same facade through
`useSnapbackAuth()`; neither owns another coordinator. Browser durable custody
restores the guest across cold start, Expo's explicitly volatile grade returns
anonymous after restart, and unsupported custody refuses before transport.
`auth.claimGuestWithPassword()` preserves the guest principal while replacing
authority through the existing successor transition; collision refuses without
identifying the occupied account. Logout and the declared default-tombstone
reaper retain their existing terminal semantics.

Denial coverage now pins disabled policy, exhausted effect budgets, malformed
caller-selected identity/session/expiry/cleanup fields, CSPRNG failure,
unsupported cleanup and custody, reaped sessions, and claim collision to
stable non-enumerating diagnostics. The packed browser/Expo proof covers guest
entry, an authenticated operation, the declared restart grade, claim, recovery
custody, and logout from installed package tarballs. The generated lifecycle,
Expo template/start packet, Guide, capability index, retrieval corpus, and
LLP 0258 now describe the shipped route.

Verification included the packed browser/Expo battery; password-auth,
framework-neutral and React authority-transition conformance, application
client, coordinator, IndexedDB/SecureStore custody, focused server guest, and
kernel atomic-budget suites; Ibex bootstrap/runtime qualification; and Guide,
retrieval-eval, ref-check, and package-test inventory gates.

**Landing SHA:** TBD
