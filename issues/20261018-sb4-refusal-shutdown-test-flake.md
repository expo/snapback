# Snapback 4 refusal shutdown test intermittently observes the writer lock

Status: Open
Owner: serve lifecycle / STAGE follow-up
Date: 2026-10-18

SEC's final full CLI-unit run passed 470 tests and failed
`serve::tests::refusal_tests::stopping_admission_flushes_console_entries_that_cannot_expire`
at tests/serve_refusals/mod.rs:265: `dev_refusals::recent(...).is_err()` was false.
The same whole target passed earlier (471 tests), and the isolated exact test
passed afterward in 0.03 seconds. Runtime shutdown code was not changed by SEC.

Evidence: reports/20261018-sec/logs/cli-latest.log.gz and
reports/20261018-sec/logs/cli-flush-rerun.log.gz (under snapback4/).
The test receives an Output-drop signal before inspecting the writer lock.
That signal may precede other resource drops; this is a hypothesis, not a
confirmed production lifecycle defect. Review the ownership/join boundary
rather than relaxing the assertion or hiding the original failure.

Reproduce with the full CLI target and then the exact named test. Use timeouts
and CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0.
No security bypass is claimed. STAGE owns serve-lifecycle coordination.
