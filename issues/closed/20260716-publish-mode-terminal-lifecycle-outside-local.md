# Publish committed mode terminal lifecycle outside LocalSnapback

**Status:** Closed
**Severity:** P1
**Systems:** Auth mode transitions, Connection grants, Live queries, Runtime
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Locking and linearization; LLP 0059 §Reset, restore, and stream publication
**Marker:** auth, lock-order, mode-transition, release-blocker

**Resolved:** 2026-07-17

The Local commit/private-projection phase now returns a fail-closed
`CommittedModeTransition` carrier. An independently owned task performs the
complete terminal lifecycle and runtime mode publication after releasing the
committing Local scope, then explicitly publishes the successor epoch. Unit,
live-grant, old-bearer-refusal, and canceled-waiter regressions cover the
carrier boundary and lock order.

`commit_prepared_auth_provision` commits and publishes a mode transition inside
`with_snapback`, then calls `AuthTerminalLifecycle::committed_mode_transition`
from that same closure. Terminal propagation acquires the connection registry
and notifier/ephemeral state, violating the unconditional prohibition on those
locks beneath the managed `LocalSnapback` writer. The new lock-scope assertion
makes the violation a deterministic debug/test panic.

**Done when:**

- The durable mode transaction remains the only work performed under Local;
  no connection-registry, notifier, room, outbox, or other ephemeral lock is
  acquired there.
- The admission transition remains closed after the known durable commit while
  independently owned off-Local work terminalizes predecessor connections,
  publishes the exact runtime mode state, and only then reopens the successor.
- Request cancellation cannot reopen admission between durable commit and that
  terminal/runtime publication.
- Rolled-back and uncertain durable outcomes preserve their existing exact
  admission semantics without publishing a false successor.
- A deterministic mode-transition test exercises a live predecessor grant,
  proves old-bearer refusal/terminal cleanup, and runs with the Local lock-scope
  assertion enabled.
- Focused auth-mode/server tests and the canonical proof pass.
