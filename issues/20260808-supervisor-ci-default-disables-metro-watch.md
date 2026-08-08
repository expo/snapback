# Supervisor defaults CI=1, disabling Metro file-watching on every supervised run

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Supervised dev loop, Expo client, Developer experience
**Date:** 2026-08-08
**Related:** issues/closed/20260808-supervisor-warn-metro-watch-blind.md
(the advisory that surfaced this); diaries 0066/0068 (three runs of
stale-bundle loops)

## Problem

Lane I's advisory work established that the supervised Expo loop spawns
Metro with `env.CI ?? '1'` — the supervisor itself defaults CI=1, and
Metro disables file-watching under CI. So hot reload is off on EVERY
default supervised run; the newly-landed
`SNAPBACK_EXPO_METRO_WATCH_INERT` advisory fires as a standing notice.
Every measurement lane's edit-restart tax traces here.

## Ask

Decide the default: (a) drop the CI=1 default for interactive supervised
runs (keep it for genuinely non-interactive contexts — detect TTY or an
explicit flag), making hot reload work out of the box and demoting the
advisory to the genuinely-inert cases; or (b) keep the default and
document why (whatever stability reason motivated it — investigate the
original commit's rationale before choosing). Option (a) is the
edit-loop-tax fix; the original rationale must be understood first
(watch-mode flakiness under supervision may have been the motivation).

## Acceptance

Default interactive `snapback dev --expo` picks up an app-code edit
without a supervisor restart, or the guide states plainly that supervised
Metro is restart-per-edit and why.
