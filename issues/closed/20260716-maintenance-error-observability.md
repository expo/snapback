# Surface persistent maintenance and room-reauthorization failures

**Status:** Closed
**Severity:** P3
**Systems:** Server maintenance, Change journal, Ephemeral rooms, Diagnostics
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0032 L2/L3/L9, LLP 0008 §Retention and resume, LLP 0053
**Marker:** reliability

The periodic maintenance worker silently discards errors from pending room
permission resolution and change-journal pruning in `src/server.rs`. Retrying
transient failures is correct, but a persistent failure has no counter or
bounded diagnostic: a protected room can remain pending indefinitely, and the
change journal can grow past its intended retention bound without an operator
being able to distinguish that state from healthy retry.

The cron scheduler already demonstrates the desired shape by recording
tick-machinery errors in the bounded diagnostics ring.

**Done when:**

- Permission-resolution and journal-prune failures remain retryable but emit
  bounded, redacted, rate-limited diagnostics and monotonic counters.
- Inspect/status exposes enough closed facts to distinguish healthy maintenance
  from repeated failure without exposing room identities or handler text.
- Tests inject persistent and transient failures, proving retry, recovery, and
  bounded diagnostic behavior.
- Successful idle maintenance does not add lock contention or noisy diagnostics.

## Resolution

Maintenance permission-resolution and journal-prune failures now advance
separate monotonic counters and last-failure timestamps exposed through both
inspect projections. Failures remain retryable, while the existing bounded
diagnostic ring receives a redacted classification at most once per operation
per minute. The focused fault test covers repeated failures, per-kind rate
limits, closed public projection, and non-retention of sensitive error text.
