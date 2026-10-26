# Snapback 4 arm E: single terminal-outcome arbitration; PG17 transaction_timeout on certificates

**Status:** Closed
**Resolved:** 2026-10-26
**Opened:** 2026-10-26
**Area:** `engine/command_batch.rs` (~383), `engine/command.rs` (~210, `Queue::drop` ~432), `engine/postgres/early_release.rs` (~411), `engine/postgres/ownership.rs` (~147, ~165)
**Related:** LLP 3000.009.001.000.000.002 §3.8–§3.9 (arm E, opt-in `commit=early`); arm E final review (Sol CHANGES REQUIRED with two P2s; Grok APPROVE)

Neither finding affects acknowledged-write durability or lost-history
release (both reviewers). Both are edge cases outside the S1 measurement
(PG16, no mid-run ownership loss). Fix forward:

1. **Double terminal outcome.** Pause rejection calls `task.unknown()`
   without arbitrating against the ticket's ownership-loss callback (also
   the new solo callback). Park recovery, enqueue a command, lose ownership:
   `lose_ownership()` fills the capacity-one reply channel with
   `OwnershipLost`; after recovery fails, pause rejection blocks sending
   `OutcomeUnknown`; dropping the queue joins the blocked worker → shutdown
   deadlock. Use one shared completion arbitration for every terminal reply;
   witness with ownership loss **before** replies are consumed.
2. **PG17 `transaction_timeout`.** Marker and recovery certificate
   transactions zero `statement_timeout` and `lock_timeout` only; PG17's
   `transaction_timeout` (admitted by connection admission) can still
   terminate a slow certificate. Set `SET LOCAL transaction_timeout = 0` on
   PG ≥ 17 (version-aware) or refuse an incompatible configuration; PG17
   slow-certificate witness.


## Resolution

All program and solo terminal publishers now share `Completion<T>`, whose
single sender is taken once before a nonblocking send. Ownership loss,
pause rejection, unknown results, preparation/continuation panics and
certified results use that same arbitration. A consumed reply cannot reopen
completion. Started work retains its actual result.

`g7e_ownership_loss_before_pause_rejection_drops_queue_with_unread_replies`
parks recovery, enqueues both command kinds, loses ownership while their
replies are unread, fails the recovery through a superseded epoch, and
drops the queue before consuming either reply. It fails against `bcf780d307`
with `Queue::drop deadlocked on a second terminal reply` and passes with
both replies retaining `OwnershipLost`. The completion unit test also
rejects second results before and after the first receive.

Marker and recovery certificate settings conditionally execute `SET LOCAL
transaction_timeout=0` on PG17 and later, within the existing SQL message.
PG16 does not execute the unsupported setting. Marker command-count
validation includes the conditional's tag on either version.
`g7e_pg17_marker_ignores_session_transaction_timeout` and
`g7e_pg17_recovery_ignores_session_transaction_timeout` run on a separate
private PG17 cluster. Their deferred COMMIT waits are 600 ms against a
300 ms session transaction timeout. Both fail before (unknown outcomes;
server transaction-timeout termination) and pass after, with the session
default restored. The protected port-55440 cluster is untouched.

The requested verification and process-custody results are recorded in the
[G7-E report](../../snapback4/reports/20261025-g7e-postgres/REPORT.md#g7-e-fix-forward--terminal-completion-and-pg17-transaction-timeout).
