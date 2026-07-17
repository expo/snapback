# Eliminate the auth publication lock inversion

**Status:** Closed
**Severity:** P1
**Systems:** Auth, Live queries, Connection grants, HTTP, WebSocket, Ephemeral state
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Locking and linearization; LLP 0053
**Marker:** deadlock, auth, realtime, regression

Concurrent authenticated live subscriptions could deadlock permanently. One
request finalized its HTTP response while holding the mode-admission mutex and
waiting for the shared authorization-stream fence. A second request held that
stream fence, its session leaf, the exact connection registry, and
`LocalSnapback`, then waited for the same mode-admission mutex at query-result
publication. A three-second process sample showed both native stacks parked on
those opposite edges for every sample.

The inverse was not confined to HTTP response finalization. WebSocket
handoffs/drains, HTTP outbox drains, connection opening, and ephemeral
operations also composed the same locks in inconsistent orders.

**Done when:**

- LLP 0059 pins one combined order: stream, optional session, exact connection
  registry when present, mode-admission effect guard, bounded leaf.
- Every HTTP, WebSocket, outbox, connection-open, and ephemeral publication
  path follows that order, including first-body leased-batch acknowledgement.
- The RBAC acceptance test names phase deadlines and disposes every successful
  live subscription even after partial concurrent success.
- Repeated concurrent authenticated live subscriptions complete without a
  timeout, and the full auth/server proof remains green.

## Resolution

Closed 2026-07-16. Response finalization and every connection-bound realtime
handoff now take the authorization leaf and exact registry before the
independent mode-admission guard. First-frame HTTP acknowledgement uses the
same order instead of entering the connection fence beneath a body-mode guard.
Twenty consecutive real RBAC acceptance runs passed after the change. The
separate, pre-existing structural problem of running app/SQLite work beneath
the leaf locks is tracked by
`20260716-stage-connection-live-effects-outside-auth-fences.md`.
