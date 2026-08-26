# Dev error overlay intercepts app controls during intentional offline testing

**Status:** Closed
**Opened:** 2026-08-25
**Systems:** React/Expo, Diagnostics, Offline sync
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 1, M6)

## Problem

During M6 offline testing on published 0.1.27 (Expo web), intentional
network loss produced unhandled rejections from best-effort presence/typing
writes, and Snapback dev diagnostics rendered the Expo error overlay —
which then intercepted send-button clicks, breaking the very offline
interaction under test. The capstone builder needed three correction loops:
suppress best-effort presence writes while offline, make connectivity state
event-driven (a `navigator.onLine` read raced Playwright's network
emulation), and finally a MutationObserver that neutralizes the overlay
during intentional offline tests — a workaround no app should need.

## Wanted

- Best-effort ephemeral writes (presence, typing) should not surface
  unhandled rejections when the transport is offline — an expected-offline
  refusal should be a quiet, classified outcome the client absorbs.
- A guide note for offline testing under the dev overlay (what fires it,
  how to keep intentional offline scenarios interactable) until/unless the
  above makes it moot.

## Resolution (2026-08-26)

Delivered in Lane P2. The subscribed `EphemeralOverlay` now absorbs only a
transport-dispatch failure (`fetchDispatchFailed`) as the classified
`SNAPBACK_EPHEMERAL_OFFLINE_DROPPED` outcome: `status: "dropped"`,
`reason: "offline"`, `queued: false`. Permission, validation, and server
refusals remain rejecting. React retains active intent in provider memory and
may retry it on reconnect before LLP 0257's idle deadline; no ephemeral write
enters the durable outbox. React and Expo regressions prove an ignored write
does not emit `unhandledRejection` and the activity surface exposes the
classified publisher error. The Guide now documents intentional offline tests
under the dev overlay at
`guide/realtime/ephemeral-state.md#test-intentional-offline-behavior-with-the-dev-overlay`.

Dropped DELETE attempts are also observable: the React/Expo activity surfaces
retain `publisher.status: "publish-error"`, the classified diagnostic, and
`lastError` instead of clearing them as though withdrawal succeeded. The
reconnect-before-idle regressions now prove provider-memory desired state
survives a dropped publish and republishes when the room becomes ready again.

## Non-blocking review follow-ups (2026-08-26)

- `acknowledgedPair` is cleared before a fenced delete settles. If that delete
  is dropped offline, a later cleanup can skip the pair and leave the remote
  entry until TTL expiry. Preserve/retry the pair without letting it cross an
  authority fence.
- `SnapbackClient.#republishAfterAuthorityReplacement` currently treats an
  outcome with no explicit `accepted: false` or `ok: false` as acknowledged;
  a classified `status: "dropped"` outcome therefore counts as acknowledged.
  Make successor republish require an explicit accepted/success disposition.
