# Supervisor defaults CI=1, disabling Metro file-watching on every supervised run

**Status:** Resolved 2026-08-10
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

## Investigation and resolution (2026-08-10)

`git blame` traces `CI: env?.CI ?? '1'` to `567a8e0fd5` (2026-08-05), the
initial supervised Expo loop and headless E1 acceptance harness. Neither that
commit's message, its LLP 0181 update, nor its tests record a Metro-watch
stability rationale; the only contextual signal is that the first proof was
headless/non-interactive. The later advisory commit `4c4287dba6` confirms the
default disables watching and records the resulting stale-bundle cost, but
does not uncover an earlier flakiness requirement.

Choose option (a), narrowly: an omitted `CI` now remains omitted for Metro, so
the default supervised development loop watches files whether or not its
controller has a TTY. Any explicit caller value is preserved unchanged, so CI
and other hermetic launchers retain `CI=1` by setting it deliberately. This
matches LLP 0041's watch-loop acceptance without guessing that non-TTY means
hermetic. The spawn-environment decision and advisory behavior are covered in
`packages/snapback-cli/expo-metro-watch-advisory.test.mjs`.

## Resolution — 2026-08-10

Investigation recorded in-ticket: `567a8e0fd5` introduced `CI: env?.CI ?? '1'`
with no Metro watch-stability rationale (headless E1 proof context only);
`4c4287dba6` documented the stale-bundle cost. Option (a) implemented:
omission is preserved for normal supervised dev loops (Metro file-watching
on by default); an explicit caller `CI` value is preserved byte-for-byte so
hermetic launchers opt in deliberately. Spawn-environment acceptance covers
omitted/`1`/`true`/`0`/`false`/empty.

## Supersession note (2026-08-24)

The "explicit caller `CI` values are preserved byte-for-byte into the Metro
child" half of this resolution is superseded: under LLP 0241 D6 the
supervised Metro arm is a watch custodian by contract, and the
published-0.1.25 Clique pair plus the Q-a probe showed explicit-CI
passthrough (the normal headless-agent environment) silently disabling all
file watching — the "kill Metro" ritual. The supervisor now always strips
`CI` from its owned Metro child; the controller's own environment is
untouched, and unsupervised `--client-command` invocations still get the
`SNAPBACK_EXPO_METRO_WATCH_INERT` advisory. See
`issues/20260824-metro-generated-module-freshness.md` (lane H landing).
