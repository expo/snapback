# Phase-1 per-commit turn overhead ~4x at scale (zero-observer settle p50 171→629 ms)

**Opened:** 2026-08-08 · **Severity:** P1 remainder (H-1 "zero-observer
settle unchanged" unmet) · **Owner seam:** LLP 0200 §2.2 scheduler hand-off

Measured (Phase-1 A/B vs the OQ4 spike's same-shape arm, 5.5M-row
baseline, N=1): with zero observers the 48-mutation burst settles at p50
629 ms / 728 ms (trigger/non-trigger) vs 171/130 ms on the pre-Phase-1
binary — roughly 4x per-commit-turn overhead (~21 ms → ~80 ms serialized
cost per mutation) with no evaluation work at all. The response leg is
fast (durable→response p50 3.4 ms), so the cost sits in the commit turn
or the lock hand-off. Suspects, unprofiled: scheduler-worker wake +
lock ping-pong on every commit (notify → acquire → empty drain), pending
change-list clone/enqueue, per-commit fence classification, watermark
bookkeeping. Profile with the spike trace's commit events, fix, and
re-run `p1-burst-obs0` against the recorded arm. Absolute overhead at
small stores is likely negligible (all acceptance suites green), so this
is a scale-tier defect, not a ship blocker — but H-1 requalification
needs it closed.

## Resolution (2026-08-09, Lane C of the LLP 0200 program)

**Closed fixed.** Profiling (spike-trace decomposition + targeted turn
timing + kill-switch bisect on the af0fbd5bf binary) refuted every suspect
this ticket named: with zero observers the scheduler is never woken
(`enqueue_live_data_fanout` early-returns before `request_flush`), no
fence/watermark events fire, and *everything* after commit-durable costs
0.26 ms p50. `SNAPBACK_LIVE_SCHEDULER_DISABLED=1` on the same binary still
settled at 446/712 ms — the regression was not scheduler-conditional.

Measured root cause: the two-turn staged authorization write
(`with_snapback_staged_authorization_write`) pays one ~29 ms global-lock
stage turn (Hermes handler) plus a second commit turn per attempt, and the
released-lock window between them let any interleaved commit stale every
in-flight staged mutation (the reservation snapshot pairs the data head
with the auth witness), driving 5.6 attempts per applied commit (60%
`SNAPBACK_AUTH_RESERVATION_STALE`) vs 3.6 pre-Phase-1 — a positive-feedback
retry cascade under burst.

Fix: authorization-neutral preflights
(`AuthorizationCommitPreflight::NoAuthorizationEvent` — the hot data path)
now commit in the same Local turn that staged them, with the no-op
reservation installed directly; no lock release, no stale window, no
second turn. Auth-event-bearing preflights keep the exact split
reservation path; the mispreview fail-closed contract is unchanged and
newly pinned by `authorization_neutral_stage_mispreview_still_fails_closed`.

A/B (p1-burst-obs0 arm, 5.5M-row baseline, trigger/non-trigger settle
p50 ms): recorded Phase-1 629.0/727.9; fresh pre-fix rerun on identical
code 529.4/591.3 (N=1, run-to-run noise on a loaded host); post-fix
**138.8/26.9 and 83.1/33.2** (N=2) vs pre-Phase-1 baseline 171/130 —
restored past the ~171–250 ms target. Server mutate-settle attempt events
dropped 161→106 for the same 24 applied commits.

Remainders split out: the unconditional ~1.5–2x per-stage-turn slowdown
from the de96ced6e→af0fbd5bf drift window
(`issues/20260809-mutate-stage-turn-cost-bisect.md`) and the per-mutation
`function_invocation_facts` re-lock
(`issues/20260809-mutation-facts-turn-extra-lock.md`). H-1
requalification at N≥3 rides the LLP 0200 Phase-3 exit measurement.
