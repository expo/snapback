# Preserve terminal-auth event ordering across exact effect purge

**Status:** Closed
**Severity:** P1
**Systems:** Auth terminal lifecycle, Live delivery, Ephemeral outbox
**Author:** Codex (GPT-5)
**Date:** 2026-07-17
**Related:** LLP 0059 §Typed terminal auth error; LLP 0059 §Fenced effects and live closure
**Marker:** auth, live, terminal-order, release-blocker

`AuthTerminalLifecycle` purges an exact connection effect fence before it
installs the typed terminal event. Purging an active outbox lease can expose
preserved work and wake the socket. The socket may consume that wake, observe
that its registry grant is already gone, and exit before
`DeliveryNotifier::terminalize_bound` makes the typed event visible.

**Done when:**

- Auth-terminal exact purge releases predecessor leases/effects without waking
  the readable connection id.
- Ordinary session/service/reset terminalization and the mode-transition
  pre-reopen lifecycle use that no-wake purge.
- The only terminal wake occurs after the exact typed event is visible under
  the notifier mutex.
- A deterministic active-lease regression proves the socket barrier cannot
  consume a wake before the terminal event exists.

## Resolution

Typed terminal installation now linearizes under registry then notifier: the
exact event and wake become visible before the checked grant is infallibly
removed. Exact effect/lease purge follows outside the registry and uses a
silent path. This also closes unrelated-wake races, not just purge-generated
wakes: a wake that checks before installation queues on the registry and
reaches the installed event after retirement.

Covered by
`terminal_exact_purge_releases_active_lease_without_preterminal_wake` and
`preterminal_wake_blocked_on_registry_observes_typed_event_after_retirement`.
