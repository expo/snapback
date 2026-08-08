# Supervisor should detect and warn when Metro file-watching is inert

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Supervised dev loop, Expo client, Diagnostics
**Date:** 2026-08-08
**Related:** Diary 0068; Diary 0066

Three measurement runs (diaries 0066/0068 lanes) independently lost
stale-bundle debugging loops to Metro silently not watching: watcher
blindness under `/private/tmp` working directories, and `CI=1` disabling
watching entirely. Neither is a Snapback defect, but the supervisor owns
the Metro process and can cheaply detect both (probe a touch-file rebuild
or inspect watch mode/env at spawn) and print one warning naming the
condition and the fix (`--clear` restarts / unset CI / move off the
private tmpdir). Cold agents repeatedly misattribute the staleness to
their own code first — the most expensive misattribution shape.
Acceptance: a supervised loop started with CI=1 or under /private/tmp
prints the warning in its readiness stream.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
