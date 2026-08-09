# Follow-on: move finalize Phase B (object put) outside the global writer

**Opened:** 2026-08-09
**Context:** the finalize lock choreography (LLP 0044 §Local finalize lock
choreography, landed 2026-08-09) releases the LocalSnapback writer around the
repeatable prepare (staging read/hash, canonical rewrite, media CPU,
required-variant renders). Phase B — the idempotent canonical object put —
deliberately stayed under the writer in that slice.

For large objects on remote stores (S3), Phase B is the remaining long
lock-hold on the finalize path. Moving it means a third lock window:
Phase A (planned) under the writer → put WITHOUT the writer → Phase C/D under
the writer.

Requirements for that slice:

- Preserve LLP 0044 crash cuts exactly: `planned` must still commit before the
  put begins; `staged` only after the put is acknowledged.
- The put is already idempotent to the planned key; analyze the concurrent
  double-finalize interleaving where both raced commits planned (one wins
  Phase A; confirm the loser's behavior stays identical when the winner's put
  is in flight).
- The maintenance sweep (publication_maintain) already converges orphaned
  `planned` records from crashes in the put window — verify its grace windows
  still hold when the window lengthens by design.
- Characterization tests: crash/kill between A and put, between put and C;
  concurrent finalize with slow put.

Not urgent until large-object hosted profiles are the bottleneck; recorded so
the deliberate scope cut is not mistaken for an invariant.
