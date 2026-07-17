# Blank live client state on terminal auth loss

**Status:** Open
**Severity:** P1
**Systems:** JavaScript client, AuthCoordinator, Agent custody, Live queries, Ephemeral state
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0053 §Client fences, LLP 0055 §Ending authority, LLP 0059 §Transition barrier
**Marker:** security, privacy

Terminal WebSocket auth loss closes transport and clears handshake caches, but
direct kit materializations can continue exposing data delivered under the
ended authority.

The SnapbackClient transport participant in `demos/_kit/client.mjs` registers
`blank: () => {}`. Its `clearMemory` clears registries but does not clear live
handle rows or existing overlay entries. Managed terminal `auth_error` frames
and close-only `4401/auth_error` events clear the handshake and close the
manager; live handles only observe `connection = disconnected`. Rows are
blanked only when a separate per-query authorization quarantine/delete frame
arrives, which a close-only terminal path need not send. Existing
`EphemeralOverlay` instances similarly keep returning their entries.

The current terminal tests assert closure, no reconnect, and
`compareAndClear`, but they never seed private rows/entries and inspect them
after terminal loss. Agent custody has no browser `compareAndClear`, making the
gap especially direct for grant/token termination and durable-tuple changes.

**Done when:**

- Live handles, ephemeral overlays, receipt/optimistic state, and pending
  waiters participate in the synchronous blank/delete barrier.
- A terminal frame or close-only 4401 cannot complete while prior private
  materialization remains readable, even without a preceding delete envelope.
- Delayed frames cannot repopulate a blanked authority instance.
- Tests seed private live rows and ephemeral entries, then cover session
  terminal frames, close-only 4401, peer user switches, agent token terminal
  loss, and agent durable-tuple replacement.
- Token A termination clears only A-bound query instances when token B on the
  same durable grant remains valid.
