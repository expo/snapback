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


## Triage (2026-08-26 leftover sweep)

Still open for H-1 only. Write-priority scheduling itself landed (2026-08-09 refresh). Remainder is in-flight eval-turn cost at N≥3 observers. The pointer `issues/20260809-mutate-stage-turn-cost-bisect.md` is **missing** (not in `issues/` or `issues/closed/`).

## Refresh (2026-08-09, Lane B of the LLP 0200 program)

**Write priority is implemented and landed** (LLP 0200 §6b): pending
commit turns preempt queued evaluation turns via the coalescer's
writer-visibility gate; the scheduler defers between turns (capped at
`max_hold/4` per gap); the mutate settle path is fully covered (staged
write, mutation-class scoped-token resolve, facts folded into the commit
turn). Phase-3 cancellation, age inheritance, and overload degrade
landed with it.

Measured (exit battery vs recorded Phase-1 arms, N=1 shape): burst
6-obs settle p50 15.3 s → **1.65 s**; sustained 6-obs 68.1 s → 6.8 s;
zero-observer arms 38/23 and 31/26 ms.

**H-1 remains unmet at six observers**: settle p50 1.65 s vs < 1 s,
commit-ack ≈ settle − sub-ms vs < 250 ms. The remainder is no longer
scheduling policy:

1. A just-arrived writer still waits behind one unpreemptible in-flight
   evaluation turn (~0.9–1.15 s at 5.5M rows) — structural until turn
   cost falls (D2 sharing / matcher widening ladder), since §2.5
   forbids VM preemption.
2. The per-attempt stage-turn slowdown ticketed in
   `issues/20260809-mutate-stage-turn-cost-bisect.md`.
3. Fence-applied p95 (H-1) is still unmeasured — the hot inventory
   fires no mid-burst authority transitions; the requalification arm
   needs a revocation/grant mutation added.

This ticket stays open to carry exactly that remainder and the N≥3
requalification per LLP 0189.

## Refresh (2026-08-09, LLP 0200 Phase 2)

**Fence-applied p95 is now measured — remainder item 3 closed.** The A/B
inventory gained an authority-transition probe (membership-declared
`authorityProbeMembers` + alternating grant/revoke mutations +
`--authority-transitions`, landed d885c5a8f), and the p2-authority-burst
arm (six observers, 4 mid-burst transitions) measured fence-applied p95 =
**0.09 ms** across 20 per-subscription markings vs the ≤ 500 ms §2.4
target — met by more than three orders of magnitude. Restoration latency
per (epoch, subscription): p50 4598 / p95 6959 / max 8067 ms across the 6
completed restorations (14 fences superseded by newer transitions —
§2.4's latest-authority collapse); the Phase-2 numeric restoration target
(p95 ≤ 10 s on this arm) is recorded in LLP 0200 §6c.

Also fixed forward in this window (bc26e015b): the scheduler path
deferred the revocation obligation delivery behind the writer-visibility
gate, so `blankBeforeMutationReturn` lost the settle race
(require-role-live-revocation red at clean 65064cd3a; green ×4 after
obligation projections publish inline in the commit turn —
`issues/closed/20260809-main-red-scheduler-defers-revocation-obligation-delivery.md`).

Remaining here: item 1 (unpreemptible in-flight evaluation turn — D2
ladder), item 2 (`issues/20260809-mutate-stage-turn-cost-bisect.md`), and
the N≥3 H-1 requalification.
