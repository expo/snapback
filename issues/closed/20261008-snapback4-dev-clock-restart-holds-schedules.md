# Snapback 4: after a dev restart, `clock advance` silently fires nothing while a schedule's saved boundary is ahead

Status: Closed (2026-10-08, farm round 2)
Date: 2026-10-08
Scope: Snapback 4 CLI periphery (`crates/snapback4/src/dev_clock*.rs`, `serve_maintenance.rs` advance reply); documentation
Reproduced: yes, on main cd2fa88d8b

## Evidence

App-farm round 1 cluster 7 (S-CLOCK): 14 builds (GPT 10, Muse 4), 21 diaries,
worst severity major. coaster-snap-vote-0085: "the last saved schedule boundary
was ahead of the reset clock; advancing 31m reported no new schedule and new
overdue contests stayed open". chore-draw-0103 ("dev-clock rollback on restart
requires explicit deadline/schedule cleanup when preserving the test store")
renamed schedules and rebased deadlines by hand. lunch-league-0359 and
fundraiser-thermometer-live-0242: rows stamped under +30d sort ahead of new rows
after restart. recital-slots-0157: no per-job feedback from `clock advance`.
GPT restarted servers to prove persistence, hence 10 of 14.

## Repro

```quarry
use personas alice
table counters:
  n: int
  read <- allow
  insert <- deny
  online only
job tick(periodStart: time, periodEnd: time):
  for c in counters:
    update counters[c.id] { n: c.n + 1 }
schedule ticker every 1h: tick
```

```
$ snapback4 dev --port 4796 &           # seed one counter via POST /seed
$ snapback4 clock advance 5h --port 4796
  work: {schedules: 1, chunks: 1, ...}   # n = 1 (missed periods fire once, as documented)
# stop dev, start it again on the same store
stderr: N_CLOCK_STORE_AHEAD: recent commit stamps lead the current clock by up to 17999499ms ...; use a fresh store per offset test (dev --fresh --port 4401), or restart with the same --clock-offset to continue
$ snapback4 clock advance 2h --port 4796
  work: {schedules: 0, chunks: 0, ...}   # n stays 1; no reason given
$ snapback4 doctor
  schedule  ticker every 1h → tick; last boundary 1791460800000
```

The restart warning exists (main prints `N_CLOCK_STORE_AHEAD`), and the docs say
the offset resets. What is missing is at the point of confusion: the advance
reply says `schedules: 0` with no hint that `ticker` is held because its last
boundary is still ~3 h ahead of the clock.

## Suggested fix (periphery; not attempted in this lane)

- `POST /dev/clock/advance` (and `clock advance`): list each schedule that did
  not fire because its saved boundary is ahead of `now`, with the boundary and
  the advance needed, and name the jobs/rows each fired schedule touched.
- `dev --resume-clock`: restore the offset implied by the store's newest
  commit/boundary, so continuing a time test on the same store is one flag
  rather than remembering `--clock-offset`.
- Optionally `clock reset-schedules` for a dev store, rewinding saved
  boundaries to the current clock (dev only; never on serve).

## Resolution (2026-10-08, farm round 2)

Round 2 kept this at the top of the open Snapback list (10 builds, 27 min,
8 GPT). Two new diaries pinned the remaining confusion:
rat-trap-sensor-0891 ("First `clock advance 7h` across 06:00 fired no
schedule (`schedules:0`)") and laundromat-machine-map-0829 ("fired schedule
for latest (empty) period"). Reproduced both, plus the restart hold above.
The first is not a hold: `every 1d at 06:00` is 06:00 UTC, and a 7-hour
advance from 00:47 Pacific does not cross it. The second is the documented
"missed periods fire once" coalescing, with no word about it in the reply.

Periphery fix, no core change (`crates/snapback4/src/dev_clock_store.rs`,
`serve_maintenance.rs`, `serve.rs`, `verbs.rs`, `main.rs`):

- `POST /dev/clock/advance` / `clock advance` reply gains `schedules`, one
  entry per schedule: `fired`, `periodStart`/`periodEnd`, the job `run`
  (state, rows, error), `skippedPeriods` with a `run <job>` hint when the
  advance crossed several boundaries, otherwise a `reason`: next boundary in
  UTC with the wait, "held by the store" with `heldUntil` and the advance
  needed, schedules held by `--hold-schedules`/`--replay`, or a newly started
  or changed schedule.
- `dev --resume-clock` takes the offset from the store's newest recent
  commit stamp (or saved schedule boundary); refuses with `--clock-offset`,
  `--fresh` or `--memory`.
- dev prints `schedule <name> is held until … ; clock advance <dur> or
  restart with dev --resume-clock` at startup; `doctor`'s schedule line shows
  UTC times, the next boundary, and "ahead of the clock: held until …".
- `guide jobs`, `why N_CLOCK_STORE_AHEAD` and CLIENT-AND-OPERATIONS describe
  the report, UTC schedule times and `--resume-clock`.

Not done: the optional `clock reset-schedules`; `--resume-clock` covers the
restart case. Test: `crates/snapback4/tests/clock.rs`
`advance_explains_each_schedule_and_resume_clock_releases_a_restart_hold`,
plus unit tests for the UTC formatter and resume offset.
