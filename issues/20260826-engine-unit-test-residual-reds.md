# Engine unit-test residual reds after the target compiles again

- Status: open
- Created: 2026-08-26
- Area: `crates/snapback-engine` unit tests
- Found by: the review of the lane that made `cargo check -p snapback-engine --tests` compile

## Context

The engine unit-test target had not compiled at all for most of a day (six errors, recorded in
`issues/20260825-engine-unit-tests-do-not-compile-on-main.md`). With those fixed the target runs, and
the failures behind them become visible for the first time.

The review characterised the run precisely: **0 introduced, 26 inherited or ambient.** That
classification matters — a lane that unmasks 26 failures should not be blamed for them, and equally
they should not be quietly absorbed.

## The 26

| Count | Failure | Disposition |
| --- | --- | --- |
| 22 | every `local::engine::admission_fence_tests::*` failure | the previously recorded Linux `/proc/self/fd/*` SQLite defect — already tracked in `issues/20260824-backup-image-fd-path-fails-on-linux.md` |
| 2 | grant approval and grant denial tests | fixture setup fails with `SNAPBACK_AUTH_AGENT_POLICY_MODE_INVALID`; the faulty setup predates `c2016d224` and was untouched |
| 1 | `permission_fields_churn_and_randomized_oracle_emit_the_committed_receipt` | reports 12 frames versus an expected 21; body and assertion predate the base |
| 1 | `retry_churn_at_the_global_cap_does_not_starve_unrelated_mutations` | **ambient intermittent** — it caused the 572/26 run, then passed in isolation and in a repeated full run which came out 573/25 |

## What needs doing

The 22-test Linux signature already has a ticket. This one exists for the remaining four, which had no
coverage:

1. The two grant approval/denial fixtures set an agent policy mode the API rejects. Fix the setup, or
   record why the mode is invalid and what the fixture should use instead.
2. The permission-fields churn oracle expects 21 frames and observes 12. Determine which number is
   right — an oracle that expects more frames than the system emits is either a real regression that
   predates the base or a stale expectation, and those need different fixes.
3. The retry-churn test is **intermittent**, which is worse than a stable red: it will pass in CI often
   enough to look healthy and fail often enough to erode trust in the suite. Either make it
   deterministic or mark it explicitly as flaky with a tracking reference; do not leave it silently
   ambiguous.

The review that produced this list was read-only and so could not file it, which is why it is being
filed here rather than by the reviewer.

Related: `issues/20260825-engine-unit-tests-do-not-compile-on-main.md`,
`issues/20260824-backup-image-fd-path-fails-on-linux.md`.
