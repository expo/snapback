# Snapback 4: intermittent refusal cleanup and resolver fixture readiness assertions

Status: Open
Date: 2026-10-16
Scope: `serve::tests::refusal_tests::stopping_admission_flushes_console_entries_that_cannot_expire` and `verbs::witness::preparation::tests::stalled_resolver_sigterm_is_bounded_journalled_and_drained`

PUBFIX29b's complete `cargo test -p snapback4-lang -p snapback4 --no-fail-fast`
run failed these two unchanged CLI unit tests (437 passed, 2 failed, 5 ignored):

- `tests/serve_refusals/mod.rs:262`: after the writer completion notification,
  `dev_refusals::recent(...).is_err()` was false.
- `src/verbs/witness/preparation.rs:504`: `descendant.pid` did not exist at the
  resolver fixture's readiness assertion.

Both tests passed in two earlier broad runs in the same workstream. A subsequent
complete `cargo test -p snapback4 --bin snapback4` rerun passed all 439 tests,
with the same 5 platform/environment ignores. No code changed between failure
and rerun. Neither failing file differs from base `92878680fc`. All commands
used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`;
Linux reports 96 available CPUs and Cargo used its default libtest concurrency.
Passing repetitions do not close this ticket or establish the failure's cause.

Investigate cleanup acknowledgement versus lock release and fixture readiness
versus resolver cancellation. Preserve the shutdown, ownership, drain and product
deadline assertions; do not suppress the cases or raise their bounds based only
on this observation.

Evidence: PUBFIX29b's WORKSTREAM-REPORT.md; local full logs retained under
`snapback4/target/pubfix29b-evidence/` (`pubfix29b-rust-clean.log`,
`pubfix29b-cli-unit-rerun.log`, and the two earlier broad-run logs).
