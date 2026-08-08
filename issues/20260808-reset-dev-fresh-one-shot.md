# One-shot deterministic dev reset: snapback reset --dev-fresh

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** CLI, Local server lifecycle, Auth, Seeds
**Date:** 2026-08-08
**Related:** Diary 0068; Diary 0066

Diary 0068's bare lane paid three restart loops to a cluster of
individually-correct refusals around state lifecycle: content-addressed
seed identity (`SNAPBACK_SEED_VERSION_REUSED`), untracked-seed residue
after a raw `reset --seed` (`SNAPBACK_SEED_NONEMPTY_UNTRACKED`), and
`app.reset` invalidating sessions so the supervised client boots to
`SNAPBACK_AUTH_REQUIRED` until the supervisor re-mints. Each refusal names
its own fix; collectively the deterministic escape the lane converged on
by experiment was "fresh DB + restart supervisor + re-mint."

Ship that as one command: `snapback reset --dev-fresh` (dev/supervised
targets only) — fresh database, seed re-apply, supervisor-coordinated
session re-mint, one readiness report. Keep every individual refusal
unchanged for partial operations. Acceptance: after arbitrary schema/seed
edits, one command returns a supervised Expo loop to a booting, seeded,
authenticated state with no manual sequence.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
