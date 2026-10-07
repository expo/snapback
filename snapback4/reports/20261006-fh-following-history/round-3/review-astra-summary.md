**NOT READY** at `8adc7879dd`. Two changes are required:

1. **P1: Resuming with a smaller output allowance panics.** A preparation unit stages three events; resuming with `output_bytes=1024` reaches the assertion at `following_history/session.rs:315`. Retained output must be preflighted and refused without advancement. The probe confirms the same token recovers when its allowance is restored.

2. **P2: Post-B follow obstruction still reports `preparing`.** Eight churn slices produced no `stalled` response. Progress was preserved and history completed after additions stopped, but the phase violates your ruling. Update the implementation, regression assertion and documents that still call this decision open.

I found no additional skip/repeat defect. Discovery and refill ordering support the prefix proof; selection, publication and replay recheck current authority. Session isolation and atomic advancement look sound. The O(F/64) map cost is explicitly metered. The oracle is independent, though terminal-exhaustion and mutation-interleaving coverage could be stronger.

Verification passed:

- Following history: **22 tests**, including scale with `--include-ignored`.
- History research: **3 tests**, including ignored cases.
- Affected timeline suites: **8 core, 65 language, 42 CLI, 26 device** passes.

Both independent review probes reproduced the findings above. The internal milestone need not wait for the route or SDK once these defects are fixed.

[Detailed review and evidence](/home/ccheever/sb4-intent/reviews/fh-r1.astra.evidence/REVIEW.md). eb1000 only; clean lane, no pushes, one **1.6 GB** cargo target.