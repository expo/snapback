# Snapback 4: after a dev restart, `clock advance` silently fires nothing while a schedule's saved boundary is ahead

Status: Open
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
