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

## 2026-10-25 — FF3 fix-round qualification on Linux

A default-concurrency full `snapback4` binary run at the FF3 implementation
`f8e5b0f9ed` passed 605 tests and failed the same unchanged fixture at
`tests/serve_refusals/mod.rs:282`: the final `recent(...).is_err()` assertion was
false after the Output-drop notification. The exact isolated case then passed
(1/0), and the complete binary target repeated with eight libtest threads passed
606/0, with 54 existing ignores. No source, assertion or deadline changed between
these runs. Both the fixture and `src/dev_refusals.rs` are byte-identical to the
lane's base `ae8c68c0e8`.

Local evidence stays outside Git under `/tmp/sb4-ff3f1/`: `clean-binary.log`,
`binary-cleanup-isolated.log` and `final-binary.log`, with command/status and
PID/start-identity receipts in `checks.jsonl` and `pids.jsonl`. The passing
repetition corroborates the existing intermittent class; it does not establish
the cause or close this issue. The FF3 change does not modify refusal shutdown.
