# Server idle CPU regressed past the telemetry phase-1 ceiling

**Status:** Closed
**Found:** 2026-08-04, by the Linux telemetry receipt re-mint
(`issues/20260804-telemetry-receipt-linux-remint.md`)
**Resolved:** 2026-08-04

At main 5df6d666f the phase-1 idle proof measured **12 CPU ticks
(120 ms)** in the idle window against the 100 ms / 10-tick ceiling —
two independent runs, identical readings (user 7-8, system 4-5 ticks),
write-IO 0, RSS growth 0. The retained receipt's revision (de86d22a)
passed the same gate, so the regression landed in
de86d22a..5df6d666f.

## Resolution

A parent-owned `strace -ff` run identified the cost: the autonomous jobs
worker called `pending_job_count()` once per second even when the durable jobs
table was empty. Over the 120-second window that produced 320 SQLite `fcntl`
lock operations on one Tokio worker. This polling predated the measured
regression range; later growth in the ordinary always-on server path merely
pushed its standing cost beyond the phase-1 ceiling.

The worker now has a process-local activity hint. Startup hydrates it once
from the durable pending/claimed count, every committed enqueue arms it before
the `LocalSnapback` lock can be released, and the worker refreshes and clears
it under that same lock after the durable queue drains. An empty instance's
one-second tick therefore performs only an atomic load and never enters
SQLite. Durable job rows remain authoritative, including crash recovery.

Verification on the provisioned Linux lane:

- The focused enqueue/restart/drain regression test passed, proving that a
  committed enqueue arms the hint, a restart recovers it from durable state,
  and an empty queue clears it.
- A clean release build passed the repository's full
  `telemetry-phase1-idle-proof.mjs` harness over 120 seconds: **6 CPU ticks
  (60 ms)** against the 10-tick ceiling, zero storage mutations, zero process
  write bytes, and zero RSS growth.
- `./ref-check --verbose` passed with 0 errors and 0 unchecked references.

The source-revision-bound receipt re-mint remains tracked by
`issues/20260804-telemetry-receipt-linux-remint.md`; this fix clears its idle
resource blocker without weakening the ceiling.
