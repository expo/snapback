# Supervisor should detect and warn when Metro file-watching is inert

**Status:** Closed
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

## Closed — 2026-08-08

`runExpoDev` now assesses Metro watch inertness with two static tiers
(`assessMetroWatchInertness` in `packages/snapback-cli/expo-dev.mjs`): the
effective Metro `CI` (mirroring the supervisor's own `CI=1` default) and the
Expo project directory resolving under a watcher-blind root (`/private/tmp`,
`/tmp`). When either holds, the readiness stream carries one advisory-only
`state: "metro-watch-advisory"` event with the stable code
`SNAPBACK_EXPO_METRO_WATCH_INERT`, per-condition human text, and remediation;
it never fails the loop. The active sentinel-touch probe was deliberately
skipped: the supervisor's Metro event stream has no reliable
rebuild-completion event to join a probe to, and a probe would write into the
user's project. Coverage: `expo-metro-watch-advisory.test.mjs` (pure env/path
tiers) plus a readiness-stream assertion in `expo-dev-loop.test.mjs`; the
react-expo guide page names the advisory in its supervisor section.
