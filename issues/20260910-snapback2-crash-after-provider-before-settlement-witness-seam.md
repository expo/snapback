# Snapback 2: missing deterministic crash seam after provider completion before settlement

Status: Open
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
