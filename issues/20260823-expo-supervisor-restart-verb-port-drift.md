# Expo supervisor `restart` verb does not reconcile a moved backend port

- Status: Open
- Date: 2026-08-23
- Systems: `packages/snapback-cli/expo-dev.mjs` (supervisor control verbs),
  `packages/snapback-cli/index.mjs` (`runDev` restart)
- Governing: LLP 0181, LLP 0223, LLP 0299
- Found by: codex review of the LLP 0299 landing (finding #6)

## Problem

`runExpoDev` exposes `dev.verbs.restart` unchanged. `runDev`'s restart
respawns the backend; when the backend is not pinned it scans its range
again. If another process took the old port in between, the backend comes up
elsewhere, but the supervisor's `backend-event` handler does not refresh
`backendRoute`, `portPlan`, the routing plan, the listener inventory, or
Android forwarding — `rotateBindingAfterLoad` then issues the Expo binding
for the old origin. The `dev-fresh` control path already performs that
post-rebind reconciliation; `restart` does not go through it.

This is pre-existing: on main before LLP 0299 the backend's default scan
could equally land on a new port after a restart. LLP 0299 narrows it (a
pinned backend restarts on the same port or refuses via the receipt-verified
stale-listener path) but does not close it for ranged/default backends.

## Fix

Funnel `restart` through the same reconciliation `dev-fresh` uses
(re-read the ready descriptor, refresh `backendRoute`/`portPlan`/route,
reinstall forwarding, re-verify listener inventory, re-issue the binding),
and add a test that occupies the old backend port during a restart.
