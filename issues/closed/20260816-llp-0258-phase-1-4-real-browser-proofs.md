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

## Resolution (2026-08-16)

Delivered in this landing. `tests/acceptance/browser-auth-bootstrap-v1.mjs`
runs all six proofs in real Chromium 151 (raw CDP) and real Safari 26.6
(safaridriver WebDriver) in one invocation with a merged witness
(`tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`)
and evidence (`tests/acceptance/browser-auth-bootstrap-v1.evidence.md`).
Outcome: every proof passes on both engines except the two-tab
concurrent-refresh check. The run found two product defects: the cross-tab
convergence defect (fixed in this landing,
`issues/closed/20260816-app-client-cross-tab-convergence-disabled.md`) and
the zero-winner refresh race (open,
`issues/20260816-refresh-race-zero-winner.md`). Firefox and Fast Refresh
remain explicitly out of scope as recorded nonclaims. Dual review
(codex + grok, three rounds each, artifacts under
`llp/reviews/0258-phase-1-4-browser-proofs.*`) converged READY.
