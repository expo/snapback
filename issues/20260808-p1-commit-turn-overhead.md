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
