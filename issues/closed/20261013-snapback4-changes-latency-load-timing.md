# Snapback 4: changes latency attribution test fails under loaded default threading

Status: Resolved
Date: 2026-10-13
Scope: `serve::tests::latency_tests::headers::changes_refresh_is_engine_work_but_poll_sleep_is_not`

Integration 8's first repaired-source five-crate run, with the host's default
96 libtest threads, failed at `tests/latency/headers.rs:209`. Sample:
`cpu=44.996, engine=368.903, total=1002.18, wait=42.18` milliseconds.
The test requires at least 600 ms outside engine/wait, but this sample leaves
591.097 ms. Its injected 150 ms refresh slept for substantially longer under
load; the request has an absolute one-second poll deadline. This is evidence
of a load-sensitive timing assumption, not proof of an attribution defect.

The test and timing implementation are unchanged from `f9e40ef515`.
The initial merge run passed this whole unit target; a focused repaired-source
rerun passed in 1.02 seconds. Neither pass closes the observed failure.
The integration also runs the complete battery with four libtest threads,
retaining all assertions, cases and work counts. Investigate a controlled
refresh/poll barrier; do not resolve by loosening the 600 ms assertion.

Evidence: `snapback4/reports/20261013-integration8/linux/cargo-final.log.gz`,
`latency-focused.log.gz`, and `cargo-bounded.log.gz` (archived with qualification).

Resolution (2026-10-13, Workstream FLAKE): replaced the assumed remainder of
a one-second deadline with the actual serving-thread condvar interval. Test-only
poll entry/resumption hooks bracket the wait; after entry, the fixture holds
it at least 600 ms and wakes it with a committed mutation. Headers and exact
registry maxima must exclude that entire observed interval from engine/wait.
The 150 ms injected refresh remains engine work. No latency bound is raised.
Focused check passed (1/1); full default-thread load runs are recorded in
`snapback4/reports/20261013-flake/REPORT.md` and `WORKSTREAM-REPORT.md`.
