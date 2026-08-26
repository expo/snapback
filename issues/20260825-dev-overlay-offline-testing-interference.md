# Dev error overlay intercepts app controls during intentional offline testing

**Status:** Open
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
