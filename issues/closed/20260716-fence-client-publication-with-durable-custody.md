# Fence client publication with durable cross-context custody

**Status:** Closed
**Severity:** P1
**Systems:** AuthCoordinator, JavaScript client, Live queries, Ephemeral state, Receipts
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Cross-context ownership and §Exposure invariant, LLP 0053 §Client fences
**Marker:** security, concurrency

Several app-visible client paths use `AuthCoordinator.isCurrent()` as their
only authority fence. That method compares process-local memory; it cannot
detect a peer context that durably changed custody while this tab missed or has
not yet processed the wakeup.

In `demos/_kit/client.mjs`, `recordReceipt` appends and invokes listeners after
only `isCurrent`. The durable live-update path mutates `handle.rows` and calls
observers after the same check. Managed-socket dispatch and ephemeral snapshot/
delta application likewise publish after an in-memory comparison. Finite HTTP
responses already use `compareAndCommit`, demonstrating the stronger intended
boundary.

A concrete race is:

1. tabs A and B share one custody record and A exposes user A's private live
   materialization;
2. B durably transitions custody to user B;
3. A's broadcast wakeup is delayed or lost;
4. an already queued user-A socket frame arrives in A;
5. A's local `isCurrent()` still returns true, so the private frame mutates
   visible state and invokes app callbacks after durable custody names B.

The same gap applies to receipt listeners and `EphemeralOverlay` publication.

**Done when:**

- Every app-visible live row, ephemeral entry, receipt, and observer effect is
  committed through `compareAndCommit` or an equivalent exact ownership fence,
  not solely an in-memory hint.
- The design respects `compareAndCommit`'s synchronous/non-reentrant callback
  rule while preventing user callbacks from exposing a stale publication.
- Two-context tests suppress the wakeup, transition custody in the peer, then
  deliver delayed managed frames, drained envelopes, ephemeral frames, and
  receipts; none may publish.
- Tests cover an observer that attempts an authority transition during
  synchronous publication and prove no stale or deadlocked outcome.
- Agent-local custody retains its exact carrier-generation fencing without
  being weakened by the browser-specific implementation.

## Resolution

Closed 2026-07-16. Commits `922eaee` and `c27cd3a` moved live, ephemeral, receipt, and
response publication behind exact custody comparison in `demos/_kit/client.mjs`, with
missed-peer-transition and reentrancy regressions in the kit client tests.
