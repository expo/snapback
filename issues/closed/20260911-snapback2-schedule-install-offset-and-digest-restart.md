# Scheduled digest fire is install-offset; restart proof can miss the period

**Status:** Resolved
**Resolved:** 2026-09-11
**Priority:** P1
**Date:** 2026-09-11
**Systems:** Snapback 2 schedules / effects (LLP 1003), Clique M8 digest
**Related:** Clique Linux lanes on `snapback2@0.0.24` and `0.0.25`

## Symptom

Clique M8 requires a real-clock digest: closed clients, a period boundary, an owner restart, then the expected push counts.

On **0.0.24** the proof passed only after several loops:

- The schedule fired on an **installation-offset minute**, not the wall-clock period the proof assumed. A 20 s poll was shorter than an observed ~42 s offset; they expanded to 90 s and recorded a “calendar-syntax limitation.”
- Point-delete of absent digest custody during cleanup was `E_REQUIRE:NOT_FOUND`.
- Authorization returned `denied` while the proof asserted `refused` (builder assertion, not engine).
- A restart mid-period still eventually produced the autonomous digest.

On **0.0.25** `scripts/digest-proof.mjs` crashed after restart:

```
AssertionError: Expected values to be strictly deep-equal:
  actual:   [0, 0, 0, 0]
  expected: [1, 1, 1, 0]
```

Owner status at failure showed `schedules.fired: 32`, `late: 5`, `status: ready`. The builder then chased digest-clock / anchor queries (`E_QUARRY_AMBIGUOUS` on `digestClock`, `E_QUARRY_UNKNOWN` “rule expression cannot be represented”). `check-digest-anchor-final.log` later said `ok`, but the proof had already failed.

Restart-surviving scheduled effects are not yet boring.

## Evidence

- 0.0.24 run-log epochs `1789169315`, `1789169597`, `1789170181`, `1789170305`; `evidence/m8-digest-proof.json`, `m8-digest-schedule-logs.json`.
- 0.0.25 `evidence/digest-proof.log`, `status-digest-failure.json`, `check-digest-anchor-fixed.log`.
- Host: expo-build-1000, ports 53100 / 53200.

## Requested outcome and acceptance

- Document or fix how a `every minute` / period-boundary schedule aligns to wall clock vs process start. A cold builder writing Clique’s digest must not need a 90 s empirical poll.
- After `snapback2 dev` restart mid-period, already-due work either fires, or the status/receipt says it will not, with a stable code. Silent `[0,0,0,0]` after 32 fires is not acceptable.
- Close with a focused test: install a one-minute (or shortened) schedule, stop the owner, start it again inside the period, and assert the effect count the product claims. Clique’s digest-proof script against a tiny fixture is enough.

## Resolution

Periodic schedules now use whole-duration boundaries since the Unix epoch on
the owner's clock. Installing or resetting midway through a period sets
`period_start = floor(now / duration) * duration` and fires at the following
boundary. On open, a legacy install-offset timer treats its persisted
`period_start` as the next unprocessed boundary for one bounded transition to
the next whole boundary, independent of retained firing history. If the owner
missed that transition by one or more periods, catch-up fires the latest
complete aligned interval before normal aligned re-arm.

The focused public-owner witness authors `every 1m`, moves the dev clock to
six seconds before the next boundary, resets through `/control/reset`, stops
the owner, starts it again, restores the same dev-clock offset, and lets real
time cross the boundary. It observes one schedule firing and exactly two
durable `push.digest` effects, one per seeded profile.

Verification on expo-build-1000, followed by the local phase-fix candidate:

- `cargo test -p snapback2-core --test timers`: 22 passed.
- `cargo test -p snapback2 --test owner owner_cases::timers::one_minute_digest_aligns_and_emits_exactly_once_after_owner_restart -- --exact`: 1 passed in 12.09 s.
- The same restart/effect witness passed on the final local candidate in 18.76 s.
- The broad outage owner test first failed its old
  `owner_before > wall + 4 * DAY` premise: epoch alignment can put the chosen
  deadline less than four wall days ahead. A final-UTC-hour review then exposed
  another phase dependency: the one-hour expiry advance crossed the daily
  boundary, producing two schedule firings where the fixture expected one. The
  fixture now advances through the public clock to 23:30, resets, crosses to
  00:30, and resets again while asserting preliminary schedules, jobs, and
  effects were cleared. Its one-hour expiry and later batch deadline are
  guarded inside their intended phases; the complete focused rerun passed
  locally in 26.61 s.
- `cargo test -p snapback2 --test guide`: 14 passed.
- `(cd packages/snapback2 && node build.mjs)`: passed; guide bundle 98,061 / 98,304 bytes.

The restart witness restores the development clock offset after the new owner
starts so it stays short; production owners use the wall clock directly.
