# LLP 0258 Phase 1.4: real-browser proofs for the browser custody path

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Auth, Custody, Browser, React, Testing
**Date:** 2026-08-16
**Governing:** LLP 0258 Phase 1 item 4 and Acceptance; LLP 0059 durable
client store
**Starting points:** `450d150e6` (Phase 1 core), `b186296fd` (React/Expo
projections), `tests/acceptance/fixtures/browser-lane/` (prior browser-lane
witness format)

## Problem

LLP 0258 Phase 1 items 1–3 landed, but item 4 — "Prove reload, two-tab
ownership, Fast Refresh/Strict Mode, logout, user switch, corruption, and
blocked recovery in real browsers" — has only unit/simulated-DOM evidence.
The IndexedDB + Web Locks adapter and the app-client owner have never been
exercised in real browser engines, so the browser rows of the D3 matrix rest
on emulation.

## Required proofs (each in at least Chromium and WebKit; Firefox where the
engine matters for Web Locks)

1. Full-page reload restores the settled principal and exact custody
   revision/epoch without credential reissuance.
2. Two tabs share one logical custody record: concurrent sign-in, refresh,
   logout, and user-switch races preserve LLP 0059's winner and blanking
   rules.
3. React Strict Mode and Fast Refresh (remount/repeat construction for one
   exact key) create one bootstrap/coordinator owner and leak no listeners.
4. Logout and user switch expose zero predecessor protected state after
   successor release.
5. Corrupted custody record surfaces the typed corruption/custody-absent
   path, never a silent fresh start or wedge.
6. Blocked recovery (e.g. lock contention/ownership loss) settles per the
   documented state machine.

Evidence: one witness bundle per engine naming browser/OS versions, the
served app fixture, and pass/fail per proof, following the browser-lane
witness precedent.

## Claim (2026-08-16)

The same fresh orchestration session claiming the Phase 2 native-custody
build (see `issues/20260815-llp-0258-phase-2-native-custody-evidence.md`)
is executing this ticket now in a dedicated lane. Per the fleet convention
this claim yields to landed code.
