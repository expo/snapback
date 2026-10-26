# Snapback 4 arm E: single terminal-outcome arbitration; PG17 transaction_timeout on certificates

**Status:** Open
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
