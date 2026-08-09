# social-messenger harness: per-milestone token phases not metered

Found in the P2 pilot (record:
benchmarks/records/2026-08-09-social-messenger-p2-pilot.md, F3).

The run-record extension schema (benchmarks/schema/social-messenger/)
defines per-milestone wall AND token phases, but the pilot's driver
(orchestrator + background agents) only observes lane-total tokens at
completion. Token caps are keyed (cap family, milestone) — they cannot
be calibrated or enforced without per-milestone token attribution.

Fix before P4: either run scored lanes under a harness that emits
per-phase token usage (the diary-0069 harness-native path), or add a
protocol-approved estimator (boundary snapshots via API usage
metadata). The P3 freeze needs a decision on which.
