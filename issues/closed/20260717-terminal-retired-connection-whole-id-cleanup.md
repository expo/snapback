# Complete whole-ID cleanup for terminal and pressure-retired connections

**Status:** Closed
**Severity:** P1
**Systems:** Connection registry, Auth terminal lifecycle, Ephemeral state, Live topology, Maintenance
**Author:** Codex (GPT-5)
**Date:** 2026-07-17
**Related:** LLP 0059 §Act-time validation; LLP 0059 §Locking and linearization; LLP 0032 §Phase 3 L2
**Marker:** auth, connection-lifecycle, resource-leak, cancellation, release-blocker

Auth-terminal and pressure-retirement sinks perform exact-fence cleanup only.
After the grant is gone, connection activity, rate buckets, connection-owned
entries, unbound room/outbox state, and whole-connection Local topology can
remain for the process lifetime. Every affected removal enables registry
mint-only containment, so the retired readable id cannot be adopted by a
successor and may be cleaned as a whole without weakening exact notifier
identity.

Maintenance also retires an entire idle batch before spawning and awaiting
cleanup sequentially. Cancellation while awaiting the first task drops later
captures after their grants have already been removed.

**Done when:**

- Auth-terminal and mint-only pressure retirement transfer each capture to an
  independently owned whole-ID cleanup task.
- Cleanup preserves an installed typed terminal notifier event, clears
  activity/rate/rooms/outbox and Local topology without lock overlap, and runs
  a post-Local whole-ID sweep.
- A later same-readable-id successor cannot be erased; the containment proof
  and regression cover this explicitly.
- Maintenance spawns cleanup ownership for every retired capture before its
  first await, so worker cancellation cannot orphan captures.
- Churn/resource and blocked-first batch-cancellation regressions prove all
  residue is removed.

## Resolution

Registry captures now carry an explicit mint-only containment proof. Those
captures transfer to independently owned cleanup that clears whole-ID
ephemeral state, performs barrier-aware Local topology removal, and repeats the
ephemeral sweep while retaining any typed notifier event. Maintenance spawns
the complete retired batch before awaiting its first child.

Covered by
`terminal_retired_whole_id_cleanup_preserves_typed_event_and_minted_successor`,
`unpolled_http_batch_is_suppressed_and_whole_id_cleaned_after_pressure_eviction`,
and `maintenance_bulk_retirement_spawns_all_cleanup_before_first_await`.

## Final-audit follow-up — 2026-07-17

Maintenance previously discarded each owned cleanup task's `JoinError` after
the registry had consumed its terminal capture. The batch owner now retains a
clone of that exact mint-only capture before spawn. A panic or cancellation is
reported with stable identifier-free `SNAPBACK_CONNECTION_CLEANUP_FAILED`
output and returns the capture to the next maintenance tick for idempotent
retry; normal maintenance cancellation still leaves every already-spawned
child independently owned. The deterministic
`maintenance_cleanup_join_failure_retains_exact_retry_capture` regression
forces a child panic, proves the requested readable id cannot be reminted,
then proves retry removes the residue with consistent registry indexes.
