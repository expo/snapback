# BP round 0 orientation

Scope: request dispatch/read checkout, FIFO writer admission, the single
maintenance thread, Following fan-out, and the live scale replay. Base
`4fd338de5`; no other lane's store is served or modified.

Governing LLPs (in `llp/current/`, none in `foundation/`):

- LLP 3000 §7: packaged SQLite build, HTTP admission and reader reuse.
- LLP 3000.013 §4: durable Following chunks, FULL commits, edge/event
  incarnation checks, FIFO admission, 1 ms quiet interval, 5 ms maximum
  pre-ticket deferral, 250 µs contended / 2 ms uncontended work slices.
- LLP 3000.013 §5.2: adaptive job sweeps, atomic cursor and progress.
- LLP 3000.019 §§3.6–3.7: independent fresh readers, reserved request classes,
  and exact meanings of total/wait/engine/thread CPU timing.
- LLP 3000.007 §20.24.4: SQ's live invalidation measurements; retain storage
  defaults absent a demonstrated improvement.

Active constraints: preserve every meter, FULL durability, publication
watermarks and incarnation checks (LLP 3000.013 §4); preserve fresh snapshots
and authority (LLP 3000.019 §3.6); never equate engine wall minus CPU with a
specific wait cause (LLP 3000.019 §3.7). The user requires measuring before
changing scheduling and stopping implementation if the Mac growth does not
reproduce. No ceiling change, push or publication is authorized.

Rationale: all engine background kinds execute serially on one maintenance
thread. A pending task is not a runnable OS thread. Request CPU and selected
CPU-set occupancy must be measured before blaming a large pending count.

Read the `bounds`, `jobs`, `feeds` and `reads` guide cards, both lane reports,
SQ's tools/evidence, the fence/NOT-DOING/journal and adopted rules. Used the
read-only llp-orient workflow from the landing checkout because this lane's
vendor submodule is uninitialized. No subagents.

Open questions: ten Linux logical CPUs differ from eight Apple performance
and two efficiency cores; the original browser load is absent from SQ's
Node replay; cache invalidation, client event-loop work, OS scheduling and
commit I/O remain distinct possible contributors. Linux scheduler delay
accounting is disabled here; no zero scheduler-wait claim follows.

Likely updates: report, evidence, portable live Mac handoff, journal and
LLP 3000.013 §4's measurement record. Operations docs only if policy changes.
Hand-off: none.
