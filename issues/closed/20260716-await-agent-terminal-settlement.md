# Await durable agent terminal settlement on finite failures

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, JavaScript client, Client store, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Transition barrier
**Marker:** security, durability, recovery

`AgentAuthorityFence.terminate()` cut publication synchronously but returned
before a durable-delete clearing intent, participant deletion, or tombstone was
confirmed. A process exit immediately after a finite terminal response could
restart into the supposedly deleted tuple and queue.

**Done when:**

- Terminal handling retains its synchronous confidentiality cut and exposes an
  awaitable exact settlement handle.
- Concurrent terminal callers share the same settlement.
- Finite HTTP paths await clearing, participant deletion, tombstone settlement,
  and final confirmation before returning the server rejection.
- WebSocket paths may remain best-effort but retain the settlement without an
  unhandled rejection.

## Resolution

Closed 2026-07-16. Commits `ece6fc4` and `cbadaf5` made terminal settlement shared and
awaitable in `demos/_kit/agent-authority.mjs` and added finite-path and
concurrent-settlement regressions in `agent-authority-custody.mjs` and
`client-errors.mjs`.
