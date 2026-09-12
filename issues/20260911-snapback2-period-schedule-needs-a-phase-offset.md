# `schedule … every` cannot express the brief's 08:00 UTC daily digest

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 schedules (LLP 1016 D5, `snapback2-core/src/store_timers.rs`, `guide schedule`), Clique M8 digest
**Related:** [closed/20260911-snapback2-schedule-install-offset-and-digest-restart.md](./closed/20260911-snapback2-schedule-install-offset-and-digest-restart.md); `rules/NOT-DOING.md` ("one `schedule` kind"; no cron/calendar syntax); [0.0.25 run](../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md)

## Symptom

`fix(snapback2): align periodic schedules across restart` (`5dddf2d046`) made
`every <duration>` fire on whole-duration boundaries since the Unix epoch. That
closes the install-phase complaint from the 0.0.24/0.0.25 lanes and covers the
grading fixture's two-minute period. It does not cover the brief's production
default: "one digest per user per day, computed at 08:00 UTC"
(`benchmarks/briefs/social-messenger.md`, Global rulings). `every 24h` is
00:00 UTC and `E_SCHEDULE_DURATION` refuses any time-of-day spelling.

The 0.0.25 Astra builder hit exactly this: "An install-phased periodic timer
did not honor the UTC anchor; a persisted anchored row timer does" (lane
`diary.md`), replaced the period schedule with a `time ?` row deadline that the
job advances to the next configured anchor (`run-log.md` epoch `1789170636`,
`essay.md`), and the final report lists "Period timers have no UTC-anchor
syntax" as a gap. The fresh scorer charged "absent UTC-anchor syntax" against
background work (82) and setup/docs (84). Three cold lanes have now paid for
this once each.

## Requested outcome

Decide one of these and record it in `guide schedule` and LLP 1016 D5:

1. **A fixed phase offset on `every`**, epoch-relative and smaller than the
   duration, for example `every 24h from 8h` → fires at 08:00 UTC. Not
   calendar syntax: no weekdays, months or local zones. Boundaries stay
   `floor((now - offset) / duration) * duration + offset`; the landed
   restart/catch-up semantics, `.periodStart`/`.periodEnd`, occurrence
   identity `(schedule, period_start)` and legacy-row reconciliation must hold
   with the offset. Requires a one-line `rules/NOT-DOING.md` trade naming what
   it unblocks (the brief's production digest without an app-owned timer row)
   and what comes off the doing list.
2. **Or** keep the grammar and pave the builder's form: a compiling
   `guide schedule` recipe for "daily at a configured UTC hour" using a
   persisted `time ?` anchor row advanced by the job, with the restart and
   exactly-once obligations stated, so the next cold builder finds it on the
   first `guide schedule` read instead of after a failed proof.

## Acceptance

- A cold published-package builder writing "daily digest at 08:00 UTC" finds a
  compiling form on the first `guide schedule` read; no 90-second empirical poll.
- The owner-restart witness from `5dddf2d046`
  (`owner_cases/timers.rs::one_minute_digest_aligns_and_emits_exactly_once_after_owner_restart`)
  passes with a nonzero offset if option 1 is chosen.
- No calendar, weekday or local-zone syntax is added; `E_SCHEDULE_DURATION`
  still names the accepted forms.
