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

## Resolution — 2026-10-12

Fixed in the LANG2 post-merge check. The test checks the counter after the
first advance and after the resumed advance against both schedules' reported
firings. The resumed hour can cross 06:00 UTC too, so both advances include
the daily schedule when it fires. Scheduler behavior is unchanged.

Validation: `cargo test -p snapback4 --test clock` — 25 passed, 0 failed,
including the previously failing test during the 06:00-crossing window.
