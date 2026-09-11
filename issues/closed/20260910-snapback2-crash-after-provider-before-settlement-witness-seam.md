# Snapback 2: missing deterministic crash seam after provider completion before settlement

Status: Closed — deterministic post-provider/pre-settlement crash witness passes (2026-09-10)
Priority: P2 (acceptance evidence)
Date: 2026-09-10
Related: LLP 1021 §Acceptance item 3; witness fix round r1 item 10

The owner integration test `owner_runs_effect_then_delivery_and_honest_restart_requeue`
kills the owner while its first provider response is still held. It proves
`running → sent_unknown → explicit requeue → sent` and one committed `then`;
it does not prove a crash after provider completion but before durable settlement.

The existing seams are the provider listener and durable outbox/log observations.
A completed provider write cannot establish that the effect consumed it and returned;
observing `then_pending` already crosses the durability boundary. Between
`Ibex2Host::run` returning and `WriterAccess::settle` sending `OutboxSettle` there
is no owner-controlled synchronization point. Sleeping or racing a kill would
be a nondeterministic test, not the requested proof.

The author's fix-round instruction forbids adding apparatus for this seam.
Follow-up: authorize a deterministic pause at that boundary, or identify an
existing seam that distinguishes it. Then kill the recorded owner PID, restart
the same store, assert the same outbox identity is `sent_unknown`, explicitly
requeue, and assert exactly one durable `then` commit. Test-owner recovery also
needs an honest binding policy: a recovered emission belongs to no later epoch
and therefore fails `E_EFFECT_UNBOUND` on explicit requeue; a successful replay
proof uses production transport plus provider idempotency.

## Reconciliation — 2026-09-11

LLP 1021's current implementation record still marks this exact crash point unproved.
Source inspection found no new owner-controlled synchronization point between host return
and `OutboxSettle`; the provider listener and durable observations still lie on opposite
sides of the required seam. No race-by-sleep was attempted.

Next acceptance is unchanged: explicit authority for a deterministic test-only pause (or
an existing equivalent seam), followed by kill/restart, `sent_unknown`, explicit requeue,
and exactly-one durable `then`. This triage adds no crash apparatus.

## Resolution — 2026-09-10

The author authorized the narrow test apparatus. A debug-build owner child can
receive `SNAPBACK2_TEST_POST_PROVIDER_PAUSE`; after the effect host has returned
from its provider and immediately before `WriterAccess::settle` sends the durable
settlement, it writes the outbox ID to `reached` and pauses. Release builds omit
the field and argument entirely, normal foreground owners do not read the hidden
variable, and no CLI, control route, or production effect API was added.

`owner_runs_effect_then_delivery_and_honest_restart_requeue` now releases the
first real loopback provider response, waits for that exact marker, verifies the
row is still `running`, kills the recorded owner, and restarts the same store.
It requires `sent_unknown`, proves no automatic replay, explicitly requeues the
same outbox identity, observes a second provider request with the same
idempotency key and same idempotent provider result, and requires exactly one
durable `then` commit. The exact test passes against vanilla Hermes in 6.08 s.
