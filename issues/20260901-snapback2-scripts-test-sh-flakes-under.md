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

## Shared live transport verification — 2026-09-05

The final `scripts/test.sh` run passed 297 package tests, 508 Rust tests,
160 evaluator cases, and 304 compiler checks. An overlapping measurement
initially packed incomplete declaration output while the compiler suite
rebuilt the same `dist/`; its failed measurement remains in the append-only
loop log. The subsequent standalone `measure.mjs --check` passed every
step, including installed-consumer qualification. Package builds and packing
must run sequentially within one worktree.

## Native memory-player repair — 2026-09-05

The final broad run passed 508 Rust tests, 160 evaluator cases, and 304
compiler checks. Package tests passed 300/301: the unchanged real-session
recovery test exhausted its 100 short manifest polls before `recovery.page`
was installed and then received E_OP_UNKNOWN. Its separate run passed all
10 tests, with the real-session case taking 4.961 seconds. Native builds
were running concurrently with the broad run. The earlier run stopped on
a guide-size error introduced while editing; the guide is back below its
4,096-byte limit and the native rebuild instructions live in the README.

## Parallel papercut fixes verification — 2026-09-07

An integrated run at `a68088c29` over `ba63c884e` used the unchanged
`scripts/test.sh`, after repairing this lane's package-local dependency link.
It took 793.840 seconds and exited 1: package tests reported 446 passes and
eight file timeouts at the existing 10-second deadline; Rust reported 768
passes and 17 failures; evaluator passed 218/218 plus two visibility checks;
compiler passed 404/405. The compiler failure's nested dead-lock recovery test
exited successfully, but its Cargo/build/test invocation took 19,416 ms against
10,000 ms. Several Rust owner/journey waits also exceeded deadlines. These
observations do not establish a common cause or reproduce the base commit.

Two non-timing findings are distinguished: the offline guide's required reset
endpoint wording was corrected, while the chat unsend replay value mismatch
remains open in [its own ticket](20260907-snapback2-offline-replay-disagrees-after-chat-unsend.md).

A package-only retry kept the script's file list and 10-second deadlines and
limited concurrency to two files: 459 passed, three failed, six cancelled,
71.514 seconds. It overlapped the compiler suite, which can rebuild `dist/`;
the retry includes missing generated `shared/offline.js` and a scaffold init
failure as well as timeouts. It is not a clean serial qualification, and those
artifact errors must not be reported as established product regressions.
Future artifact-consuming retries must follow package builds sequentially.

Full logs and command/PID/duration receipts are retained locally under
`/Users/ccheever/projects/snapback/.llp/ship-runs/20260907-parallel-papercuts/`
(`full-test-repaired.*`, `package-two-workers.*`). The full script remained
red; passing affected checks are separate evidence, not a replacement result.

After the measurement and all overlapping package builds finished, a sequential
run of Expo, typing, native-custody, and Expo-harness tests passed 49/49 in
12.113 seconds, retaining the 10-second per-file deadline. This includes the
previously failing scaffold and generated shared-module cases. The cleanup
fixture passed separately. The offline guide check first exposed two further
missing example terms after the endpoint was restored; restoring the concrete
compare-and-set mutation within 4,350 bytes then passed the existing guide
test. No assertions or deadlines were weakened, and no third full-suite run
is claimed. The separate loop measurement's functional steps passed, but its
timing overruns are retained in [the budget ticket](20260907-snapback2-loop-budget-overruns-in-parallel-papercut-lane.md).

## Bounded LLP 1018 audit delivery — 2026-09-07

The unchanged full script ran from the warm local lane on `8756e543f`.
Package tests reported 232 passes and 19 file cancellations at the unchanged
10-second deadline. Native compilation took 4m49s; after repeated owner-start
timeouts and socket `WouldBlock` failures, the owned run was interrupted.
Nextest reported 78/802 reached, 51 passed, 27 failed (including interrupted
in-flight tests), 4 skipped, and 724 not run. The offline guide size failure
reported 4,784 bytes in unchanged source. These observations do not establish
a single root cause or independently reproduce every failure on the base.

Doctests, compiler type checking, all 218 evaluator cases and both visibility
checks passed. The compiler regression phase was also interrupted after
remaining active without a result; the outer script exited 130. This is a
failed, incomplete broad run, not qualification. No second broad retry or
weakened suite deadline is claimed. The final delivery changes declarations
and focused tests, with no native/evaluator/runtime semantic delta. Its
separate affected checks are recorded in the execution ledger and LLP 1018.
The full output remains in the ignored local ship-run evidence directory.

## Public zero-count paired-proof continuation — 2026-09-07

On `6b8530f6e`, two sequential focused public-owner invocations stopped before
the test body with `owner readiness timed out` at `owner-harness.ts:138`'s
10-second deadline, after 25.57 and 31.53 seconds including bootstrap. Command:
`node --test --test-timeout=60000 --test-name-pattern='public count reads enable' tests/real-owner.test.ts`.
The harness reaped its own child. Observed host load averages ranged from
39.84/41.07/33.38 to 64.65/46.69/36.09; this is context, not a reproduced
baseline or proof of cause.

A final bounded diagnostic changed only the owner-readiness allowance to 30
seconds, kept the file allowance at 60 seconds, and passed in 19.20 seconds
(7.06-second test body). The harness was restored byte-for-byte afterwards.
No timing change ships. Twelve affected native regressions and 218 evaluator
replays plus two visibility checks pass; the preceding pre-key-guard public
run passed in 21.44 seconds with the original startup allowance. These are
separate functional/scoped results; neither the final default-deadline public
command nor the broad suite is claimed green. Logs are retained in the local
`20260907-zero-count-proof` ship-run evidence directory.
