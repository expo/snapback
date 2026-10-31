# lifecycle soft-limit test reads serve's stderr the moment stdout has its URL

**Opened:** 2026-10-30 · **Fence:** Snapback 4 · **Status:** open · **Kind:** flaky test (real race)

`crates/snapback4/tests/lifecycle.rs`
`dev_and_serve_raise_low_soft_limits_and_doctor_reports_the_server` waits only
for stdout's first line (the URL), then reads stderr and asserts two
`snapback4 host:` lines. In release mode (`serve`) the host lines are collected
in `serve_output::Startup` and written to stderr by `startup.ready()`, which
runs *after* `diagnostic_stdout!("http://{address}")` (`serve_start.rs`
~369–395). So the assertion can see 0 or 1 of the 2 lines.

Measured 2026-10-30 on the idle Apartment M5 Ultra Studio (load ~11):
`origin/main` passed 17/20 isolated runs; an unrelated branch 19/20. Under a
load average of ~300 on a laptop it failed in every broad `affected.mjs` run.

Fix options: have the test wait for `SNAPBACK4_READY` plus the second host line
in stderr (as the other lifecycle tests do), or print the collected release
startup facts before the URL. Either is a test-only or ordering-only change;
no product behavior is wrong.
