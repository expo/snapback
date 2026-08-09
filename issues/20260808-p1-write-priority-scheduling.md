# Phase-1 scheduler lacks write priority — burst settles queue behind evaluation turns

**Opened:** 2026-08-08 · **Severity:** P1 remainder (LLP 0200 H-1 unmet) ·
**Owner seam:** LLP 0200 §2.5 fair scheduling (Phase 3 pulls forward)

Measured (Phase-1 A/B, 5.5M-row baseline, N=1 shape evidence): settlement
isolation works at the response layer (durable→response p50 3.4–7.6 ms),
but client-observed settle p50 at six observers is still ~15.3 s
(trigger) because the mutate path and evaluation turns contend for the
instance lock with no priority: a 16-mutation burst interleaves with
~0.9 s evaluation turns, so aggregate lock-queue wait scales with turn
count. H-1's commit-ack p50 < 250 ms and settlement p50 < 1 s targets
require **write priority**: pending commit turns must preempt queued
evaluation turns (an evaluation yields the lock to any waiting writer at
its next turn boundary). This is §2.5 fair-scheduling content that Phase 1
deferred to Phase 3; the measurement shows it is the H-1 gate, so it moves
into the immediate remainder. Instrument: the committed A/B harness
(`demos/zerobugs/control/scripts/run-p1-ab.sh`); compare `p1-burst-on`.

Also unmeasured: fence-applied p95 (H-1) — the hot inventory fires no
authority transitions mid-burst; the requalification arm needs a
revocation/grant mutation added to the inventory to sample fence latency.
