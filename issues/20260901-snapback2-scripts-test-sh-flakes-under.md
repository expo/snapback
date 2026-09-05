# snapback2: scripts/test.sh flakes under cargo test --workspace parallelism

**Status:** Open
**Systems:** snapback2, test script, loop
**Severity:** P1
**Author:** Claude Opus 5, directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/scripts/test.sh:9 (cargo test --workspace --quiet)

Failure scenario: run scripts/test.sh repeatedly on an unmodified checkout of main (2ad65fb59). It fails on every run, with a DIFFERENT test each time. Three consecutive baseline runs on a loaded machine: (1) owner::tests::watcher_join_is_bounded, (2) owner::tests::watcher_join_is_bounded, (3) app_guide_refuses_missing_certificates_and_failed_seed_facts_as_stale AND package_consumers_and_isolated_compiler_use_complete_private_snapshots. A fourth failure seen on a working branch was test::unit_tests::silence_probe_rejects_a_heartbeat_followed_by_stream_close, which passes deterministically when its binary is run alone with cargo test -p snapback2 --bin snapback2 (24/24).

Why it happens: cargo test --workspace runs test binaries concurrently and each binary runs its own tests in parallel threads. The failing tests are the timing- and resource-sensitive ones - loopback binds, watcher joins, spawned children, bounded waits. Under load they miss their deadlines or contend for the same resource. Running the same binary alone passes.

Consequence: scripts/test.sh is one of the five blocking checks in rules/RULES.md, and it is not trustworthy on a loaded machine. This is worse than a slow gate: a check that fails randomly trains everyone to re-run it until it is green, which is the same as not having it. It also makes every agent-authored batch of fixes expensive to verify, because a red gate no longer distinguishes a real regression from noise - during this review sweep it produced two false alarms that each cost a full investigation.

Note the observation was made while several agents were running on the machine, so load is a contributing factor rather than proof of an intrinsic race; the point stands that the gate is not reliable under the conditions it actually runs in.

Suggested fix: identify the tests that need exclusive resources and stop running them concurrently - either a serial test harness for that set, per-test unique ports and temp roots instead of shared ones, or deadlines scaled to observed machine load rather than fixed. Then make the flake itself a check: run scripts/test.sh N times in the scheduled slow lane and file an issue if any run differs from the others.

## Observation — 2026-09-05

The current nextest-backed `test.sh` run on the Clique prerequisite change
passed 504/505 Rust tests, 275 client tests, 160 evaluator cases, and 304
compiler checks. The unchanged
`media_helper::tests::escaped_descendant_holding_stdout_obeys_the_output_drain_deadline`
reached its overall 2,000 ms ceiling before reaching the expected output-drain
timeout. A production build/large-seed qualification ran concurrently. A
quiet targeted rerun passed (1/1, 2.01 s). This is recorded as a timing-sensitive
suite failure and successful targeted retry, not an all-green `test.sh` run.

## Login-throttling removal verification — 2026-09-05

The removal's final broad run passed 506/507 Rust tests and 295/296 client
tests. The media-helper output-drain test above hit its same 2,000 ms ceiling;
its separate rerun passed in 2.01 s. The local-data recovery test `real
sessions change epochs across re-login, seal and cold auth; custom cursor
custody drains offline on every carrier` exceeded the script's 10-second
limit. It also timed out in the unchanged `7bcff554e` worktree. A separate
run against the removal, with a 60-second allowance, passed in 7.774 s.
The focused identity/store tests passed 18/18. These are separate passing
checks, not a claim that the complete script passed.
