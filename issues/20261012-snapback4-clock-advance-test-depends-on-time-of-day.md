# Snapback 4: `clock.rs::advance_explains_each_schedule_and_resume_clock_releases_a_restart_hold` depends on the time of day

Seen 2026-10-12 by workstream LANG2 at about 03:00–04:00 UTC; unrelated to
LLP 3000.040 (fixed-period schedules keep their arithmetic and bytes).

The test's schema has `schedule ticker every 1h: tick` and
`schedule morning every 1d at 06:00: tick`, both incrementing `counters.n`.
It advances a fresh dev 5h, restarts with `--resume-clock`, advances 1h and
asserts `n == 2`. When the first 5h advance crosses 06:00 UTC (the suite run
between about 01:00 and 06:00 UTC), `morning` also fires and `n` is 3:
`left: Number(3), right: 2`. The test already tolerates `morning` firing in
one place (`if morning["fired"] == false { … }`) but not in the final count.

Fix: assert `n == 2 + (morning fired in the first advance)`, or give
`morning` its own counter, or pin the dev clock offset so the advance never
crosses 06:00.
