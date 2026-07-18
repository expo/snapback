# Own premarked auth transitions through durable finish

**Status:** Closed
**Severity:** P1
**Systems:** Session auth, Authorization stream, Cancellation, Runtime
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Plan → Begin → Commit → Finalize
**Marker:** auth, cancellation, durability, release-blocker

Session revocation, rotation, issuance/eviction, and stream reset now install a
pending marker before asynchronously draining retained authority work. The
drain waiter rolls that exact marker back if it is cancelled while waiting.
After the drain returns, however, route code still owns the premarked carrier
in the request future while awaiting `with_snapback`. Cancellation while the
request is queued for `LocalSnapback` drops the carrier without either an exact
rollback or the durable transaction plus projection finish, leaving the
session or stream pending indefinitely.

**Done when:**

- Every successfully drained premarked carrier is synchronously transferred
  to independently owned work before the request can reach another await.
- The owned work retains the carrier through the durable transaction and its
  exact coordinator finish, including committed, rolled-back, and ambiguous
  outcomes.
- Cancellation before the transfer compare-unmarks only the exact pending
  ticket; cancellation after the transfer cannot cancel the transaction or
  projection finish.
- Deterministic tests hold `LocalSnapback`, cancel the initiating request after
  premark/drain, and prove correct settlement for revocation, rotation,
  issuance with eviction, and stream reset.
- Focused auth/coordinator tests and the canonical proof pass.

## Resolution

Each drained premark is now handed synchronously to an independently owned
Local transaction/finalizer carrier. Exact rollback remains attached until
that transfer; after transfer, request cancellation cannot cancel the durable
write or its coordinator finish, including ambiguous-outcome closure.

Deterministic coverage is provided by
`cancelled_revocation_waiter_leaves_owned_local_transaction_to_exact_rollback`,
`cancelled_rotation_waiter_leaves_owned_local_transaction_to_exact_rollback`,
`cancelled_issuance_waiter_leaves_owned_local_transaction_to_exact_rollback`,
and
`cancelled_stream_reset_waiter_leaves_owned_local_transaction_to_exact_rollback`.
The full Rust library suite passed 1,102 tests.
