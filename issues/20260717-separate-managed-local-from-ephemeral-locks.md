# Separate managed LocalSnapback work from ephemeral locks

**Status:** Open
**Severity:** P1
**Systems:** Local runtime, Auth, RBAC, Live queries, Ephemeral state, Inspect
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059 §Locking and linearization; LLP 0059 §Reset, restore, and stream publication; LLP 0058 §Same-mode provisioning; LLP 0026; LLP 0017
**Marker:** deadlock, cancellation, auth, realtime, lifecycle, inspect

Managed `LocalSnapback` work still reaches several internally synchronized
ephemeral operations. Reset takes the lifecycle, room, room-authority, outbox,
rate-bucket, and notifier locks; schema/function publication replaces
collection definitions; auth issuer install/clear reaches room authority;
durable enqueue wakes the notifier after the LLP-permitted outbox handoff; and
inspect traverses every room and outbox. These edges violate LLP 0059's
unconditional prohibited-overlap rule and can deadlock against connection and
room work whose final phase needs Local.

The durable authorization commit interlock has the same defect at a more
security-sensitive boundary: it currently prepares/quiesces room dependencies
with an open SQLite transaction and, for managed callers, while Local is held;
known-commit finalization and known-rollback exact-unmark can also re-enter the
issuer/room registry beneath Local. Preparation must instead happen before
both Local and SQLite, carry a lock-free exact ticket through COMMIT, and own
finalize/rollback after Local release. Ordinary writes must preserve exact
same-collection room liveness; widening a table hint to the whole protected
collection is not an acceptable substitute for the row/scope selector the
transaction will actually affect.

The fix must preserve lifecycle ownership, not merely move work into a request
future. Once a durable reset or provisioning transaction commits, its
process-local projections and delivery wakes must be completed by the owned
blocking work even if the request is cancelled. Reset and mode admission must
remain closed until those projections finish. Direct-library use outside a
managed Local scope remains synchronous.

**Done when:**

- Managed Local reset captures its successor runtime work and performs the
  ephemeral reset plus dropped-subscription sentinels only after releasing the
  Local guard, while the reset/stream admission boundary remains closed.
- Schema apply and preflighted function publication project collection
  definitions after releasing Local; same-mode sessions admission does not
  reopen before the projection completes.
- Auth issuer install and failed-reset clear perform their ephemeral and
  room-authority work after releasing Local.
- Authorization-changing writes precompute and quiesce an exact room selector
  before acquiring managed Local or opening SQLite. The prepared carrier takes
  no process mutex during the transaction; known commit finalizes and known
  rollback exact-unmarks after Local, while an ambiguous outcome remains
  closed.
- Exact selector planning is revalidated against both app/definition generation
  and the durable snapshot before use. A stale plan is cancelled outside Local
  and returns a typed conflict without rerunning already-executed Ibex work;
  unrelated rooms backed by the same protected collection/table remain live
  while the affected room is quiescing.
- Cancellation before Local exact-unmarks the unused reservation; cancellation
  after ownership transfer cannot strand a TLS carrier or skip commit/rollback
  completion. A closure structurally rejects a second authorization event
  unless it owns a corresponding ordered reservation.
- Durable enqueue retains only the LLP-permitted per-connection outbox enqueue
  beneath Local; notifier wakes are deferred until after guard release and are
  still owned by the blocking operation after request cancellation.
- Inspect captures Local/SQLite state first, releases the Local guard, then
  gathers ephemeral diagnostics on a blocking thread and composes one result.
- Detached-action Local scopes flush deferred work only after releasing their
  guard. Managed HostPlan actions reserve exactly once per `RunMutation` step;
  detached HostPlan/Ibex nested mutations release Local before their exact room
  wait and the watchdog cancels that wait without a late commit, receipt, or
  live publication. Direct-library HostPlan and `LocalIbexActionHost` calls
  outside managed scope execute synchronously through the same compatibility
  reservation boundary.
- Debug assertions guard the actual lifecycle, room-authority, notifier, rate,
  and diagnostics chokepoints; deterministic contention and cancellation tests
  prove ordering and ownership.
- Runtime/source inventory guards ensure every managed storage callsite capable
  of producing an authorization event uses the off-Local/off-SQLite wrapper;
  fallback interlock preparation with an already-open transaction is refused.
- The misleading `publish_preflighted_functions` comment, documentation, and
  `@ref` annotations describe both startup and network same-mode publication.
- Focused Rust tests and `./ref-check --verbose` pass.
