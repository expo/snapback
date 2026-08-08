# session mint --ready-file still demands SNAPBACK_ADMIN_TOKEN env

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** CLI, Auth, Developer experience
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

`snapback session mint --ready-file <path>` refuses without
`SNAPBACK_ADMIN_TOKEN` in the environment even though the ready-file's
sibling admin-token discovery (the 20260803-ready-file-admin-token ticket's
convenience path) could supply it. Extend the same discovery to `session
mint`. Acceptance: minting works from a ready file alone in a dev loop.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
