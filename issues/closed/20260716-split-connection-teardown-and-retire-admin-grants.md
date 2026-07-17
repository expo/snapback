# Split connection teardown and retire admin-disconnected grants

**Status:** Closed
**Severity:** P1
**Systems:** Auth, Connection grants, Live queries, Ephemeral state, Admin API
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Prohibited overlap; LLP 0031
**Marker:** auth, disconnect, lock-order, teardown, release-blocker

Connection teardown still crosses the global `LocalSnapback` writer with
notifier and ephemeral room/outbox locks. `teardown_live_stream` unregisters a
notifier and calls `disconnect_guarded` while it owns `SharedSnapback`, while
`LocalSnapback::disconnect_inner` calls the lock-owning ephemeral disconnect
implementation from beneath that same writer. The admin disconnect route uses
the same overlapping path.

The admin route also has an authority defect: it receives only
`SharedSnapback`, removes local topology, and never retires the matching
`ConnectionRegistry` grant. A bearer reported as disconnected can therefore
act or subscribe again immediately.

**Done when:**

- Admin disconnect and idle reaping first publish exact grant
  retirement/lifecycle capture, then perform notifier, ephemeral, and
  local-topology cleanup in the documented non-overlapping order.
- Ordinary WebSocket close preserves its reconnect grant as required by LLP
  0031. It instead claims the exact socket registration generation while
  cleanup runs, so a same-id reconnect cannot interleave fresh state and a
  stale socket cannot tear down its successor.
- No notifier, room, room-authority, outbox, or rate-limit mutex is acquired
  while `LocalSnapback` is owned.
- The admin disconnect route uses `AppState`, retires the intended exact grant,
  and rejects that old bearer after returning success.
- Cleanup is exact-fence scoped: a successor reusing the same readable
  connection id is not removed by delayed predecessor cleanup.
- Immediate and spawned teardown paths perform the final exact-fence outbox
  purge after local staged-effect terminalization, so a committed stage cannot
  enqueue a stale frame after cleanup.
- Deterministic tests cover old-token rejection, same-id successor survival,
  teardown before/after staged commit, and zero exact-fence backlog.

## Resolution

Ordinary socket close now claims the exact notifier generation and suspends
only its reusable grant while ephemeral, Local, and post-Local exact cleanup
run without overlapping locks. Admin disconnect and idle retirement remove the
exact grant first, enable mint-only containment, and transfer cleanup to an
owned task; the admin route awaits that task before returning 204. Terminal
and pressure-retired captures additionally receive whole-ID cleanup because
same-readable-id adoption is then impossible.

Focused proof includes
`admin_disconnect_route_retires_bearer_and_awaits_whole_id_cleanup`,
`ordinary_socket_teardown_suspends_exact_grant_until_finish`,
`stale_exact_socket_teardown_does_not_erase_same_id_replacement`, and
`staged_live_effect_binding_terminal_and_one_shot_lifecycle`.
