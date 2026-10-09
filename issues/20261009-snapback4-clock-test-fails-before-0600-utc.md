# Snapback 4: a clock test fails when it starts between 00:00 and 06:00 UTC

Status: Open
Date: 2026-10-09
Scope: Snapback 4 test `crates/snapback4/tests/clock.rs`
Related: 066a36f10b (dev clock advance explains each schedule; `--resume-clock`)

`advance_explains_each_schedule_and_resume_clock_releases_a_restart_hold`
depends on the time of day. Its schema has `schedule ticker every 1h: tick`
and `schedule morning every 1d at 06:00: tick`, and both schedules run the
same job. The test advances the dev clock by 5 h, restarts the server
(the advance is held), resumes with `--resume-clock` and advances 1 h. It
then asserts `counters[0].n == 2`.

If the real start time T is such that 06:00 UTC falls inside the
advanced span (T, T + 6 h], `morning` also fires and `n` is 3. This
happens roughly whenever the test starts between 00:00 and 06:00 UTC. The
test already allows `morning["fired"]` to be true after the first advance,
but its final count does not. The product behavior is correct: the daily
schedule really does cross its boundary.

Seen in the 0.4.17 Darwin dry-run attempt 1 on the M5 (release
0791e7fdf4). The test started at 01:50:02Z, and the dev time reached
07:50:01Z. The failure was `left: Number(3) right: 2` at clock.rs:796.
Before this, the Linux qualification ran at 19:38Z and passed, as did
0.4.16's Darwin dry run at 14:04Z.

Fix forward on main without weakening the test. Either give `morning` a
boundary the advanced span cannot reach (for example, pin it relative to
the dev clock's start), or count the morning firing. Until then, a
qualification whose `cargo test` phase falls in that window fails this
test, and a rerun outside the window on the same bytes passes it.
