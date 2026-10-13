# Snapback 4: changes latency attribution test fails under loaded default threading

Status: Open
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

Evidence: `snapback4/reports/20261013-integration8/linux/cargo-final.log`,
`latency-focused.log`, and `cargo-bounded.log` (archived with qualification).
