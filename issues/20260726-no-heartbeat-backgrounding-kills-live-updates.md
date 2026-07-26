# Improvement: no heartbeat, so backgrounding silently kills live updates — and the documented remedy makes it worse

**Status:** Open · **Kind:** improvement (client + docs) · **Filed:** 2026-07-26
**Evidence:** `demos/partitime/native/expo/NOTES.md`, `demos/partitime/REPORT.md` §6

## What

Found by shipping a real app on a real phone (Partitime × Expo).

Background the app for ~20 s, have a peer write, foreground it: **the update
never arrives, ever.** The OS freezes the socket without emitting a `close`
event, so nothing reconnects and nothing reports an error. The UI is simply
permanently stale.

## The part that makes this an improvement rather than a bug report

The author's *first* fix was to follow `CLIENT.md` §7.2 literally — treat the
socket as stale after 15 s of silence. **That made it worse**: it tore down and
rebuilt a quiet socket every 15 s and lost updates in the churn. A quiet socket
and a dead socket are indistinguishable without a heartbeat, and the documented
advice assumes they aren't.

The shipped fix reconnects on observable signals plus `AppState`.

**Comparison point:** Convex recovered from the identical test on its own in
**4.9 s with zero code from the app author.**

## Proposed

1. **Protocol/client:** a heartbeat or liveness signal so a client can tell a
   quiet connection from a dead one. Today `LIVE_HEARTBEAT_INTERVAL_MS` exists
   server-side but no client obligation is specified around silence.
2. **Docs:** correct `CLIENT.md` §7.2. The 15-s staleness rule as written
   produces churn and data loss on mobile. Replace it with reconnect-on-signal
   guidance and an explicit mobile/backgrounding section.
3. **Clients:** ship the `AppState`-equivalent reconnect in the first-party
   clients rather than leaving each app to discover it. Related:
   `20260726-first-party-clients-lack-the-invalidation-lane`.

## Note

This is the failure mode least likely to be caught by any test suite in this
repo — it requires a real OS suspending a real process. It was invisible across
110 backend checks, the fixture corpus, and 24 browser cells.
