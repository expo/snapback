# app-client owner disables cross-tab convergence: losing tab stays stale until explicit synchronize()

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Auth, Custody, Client, Browser
**Date:** 2026-08-16
**Governing:** LLP 0258 Acceptance (two-tab bullet), LLP 0059 winner/blanking
observation rules
**Found by:** the Phase 1.4 real-browser harness
(`issues/20260816-llp-0258-phase-1-4-real-browser-proofs.md`), proof 2,
confirmed by an independent orchestrator re-run against a fresh
`b7f01a693`-era binary in real Chromium 151.

## Problem

`createSnapbackAppClient` constructs its `AuthCoordinator` with BOTH
cross-context hint mechanisms explicitly disabled
(`packages/snapback-client/app-client.mjs` ~lines 630-636:
`broadcastChannelFactory: null, hintStorage: null`), overriding the
coordinator's own browser-correct defaults
(`globalThis.BroadcastChannel` / `globalThis.localStorage`,
`packages/snapback-contract/auth-coordinator.mjs` ~1081-1084). Result,
observed in two real Chromium tabs sharing one IndexedDB custody record: on
every raced transition (refresh, logout, sign-in, user switch) exactly one
caller wins and commits the durable record correctly, but the LOSING tab's
public principal/capture stays on the predecessor state indefinitely — its
direct IndexedDB read sees the winner (one logical record, revisions agree)
while its projection does not converge until an explicit `synchronize()`.

Witnessed examples (from the harness witness bundle): logout winner commits
blank anonymous custody at revision 21/epoch 10; loser's public principal
stays authenticated at revision 19/epoch 9. Sign-in winner commits revision
23/epoch 11; loser's principal remains anonymous at 21/10.

LLP 0258 Acceptance requires "Two browser tabs share one logical custody
record; concurrent sign-in, refresh, logout, and user-switch races preserve
LLP 0059's exact winner and blanking rules" — the durable record does, the
losing tab's observation does not. A signed-out-elsewhere tab continuing to
render an authenticated principal is also a state-exposure hazard.

## Expected fix shape (for the implementer to validate, not assume)

Thread environment-appropriate cross-context mechanisms through the
app-client owner instead of hard `null`s — most likely: let the coordinator
apply its own defaults in browser contexts, keep them absent where the
globals do not exist (Node/SSR), and make the choice explicit/injectable so
tests can pin it. Any fix must keep construction SSR-safe and must add a
two-context regression test at the app-client layer (the coordinator layer
already supports wakeups; the defect is the owner's wiring).

## Claim (2026-08-16)

The Phase-1.4 orchestration session (owner of
`issues/20260816-llp-0258-phase-1-4-real-browser-proofs.md`) is dispatching
a fix lane for this now; the real-browser harness that found it re-runs as
the fix's acceptance. Per the fleet convention this claim yields to landed
code.

## Resolution (2026-08-16)

Fixed in this landing: browser/expo-web app-client owners preserve the
coordinator's BroadcastChannel/localStorage wakeup defaults (injectable,
including null-to-disable, through `platform` options); other platforms
stay mechanism-free. Regression tests pin two-context convergence without
peer synchronize(), explicit-null and omitted-default behavior, Node
construction without the globals, and channel close on dispose. The
real-browser harness re-run confirms logout, sign-in, and user-switch races
now converge the losing tab automatically on both Chromium and WebKit. The
remaining refresh-race defect is separately tracked in
`issues/20260816-refresh-race-zero-winner.md`.
