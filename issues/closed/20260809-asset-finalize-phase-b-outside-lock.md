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

## Resolution (2026-08-10)

Implemented the third Local writer window. The managed HTTP finalize route now
commits Phase A (`planned`), releases the writer for the idempotent canonical
object put and verification, then reacquires it for Phase C/D
(`staged`/publication). Phase C reloads lifecycle state so double-finalize
racers sharing the exact planned key still converge on one completion and the
second observable outcome remains the ordinary idempotent response.

Characterization coverage retains both write-ahead crash cuts and adds a
test-store-gated slow-put race. That race also exercises
`publication_maintain` before the object appears and after the put is
acknowledged; current work is not condemned, and recovery-staged work is
accepted by Phase C. No grace constant changed: current-attempt status, rather
than planned-record age, is the convergence fence, while the existing six-hour
attempt expiry remains the intentional outer bound.

Resolved; the orchestrator should move this file to `issues/closed/` when it
commits the change.
