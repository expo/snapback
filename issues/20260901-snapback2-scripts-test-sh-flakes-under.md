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

## Architecture integration and upstream timing control — 2026-09-07

The LLP 1018.000 integration at `1c79e66ed` ran the canonical nextest
`local-proof` profile with eight workers on the warm EPYC `enginefix` lane:
840 tests ran, 838 passed, two failed, and four were skipped. Test execution
took **77.100 s** (79.51 s including Cargo setup), exceeding the entire
blocking-suite budget of 60 s before the JavaScript checks are counted.
The two failures were obsolete grammar expectations and an auth fixture
reading transitional successor state; their repairs retain the original
deadlines. They are tracked separately from this timing observation.

A subsequent upstream control at `a75c98406`, on the same named lane, Rust
1.97.0, profile, eight workers and unchanged limits, ran 801 tests:
800 passed, one stale offline-guide budget assertion failed, and four were
skipped. Test execution took **76.826 s** (93.25 s including rebuilding the
changed upstream test binaries). Doctests passed on both sources. The slowest
upstream test was the existing silent-socket shutdown case at 31.241 s.

These observations establish that upstream also exceeds the 60-second
budget on this machine; they do not establish a meaningful performance
difference from the 0.274-second gap or qualify the full blocking suite.
Do not increase the limit, discard failed records, or rerun until green.
The next repair should profile the inherited long-running journeys and
separate execution cost from compiler/build cost while preserving coverage.
Raw logs and the upstream JUnit record are retained under
`.llp/ship-runs/20260907-1018-architecture/native-full-{1c79,origin-a75}.*`
in the coordinating checkout.

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

## Final architecture semantic qualification — 2026-09-07

The complete unchanged script at `e94b0a61012c20dd2ba4538d7b8007d020355ea3`
exits zero on the warm EPYC enginefix lane with the configured Rust 1.93.1,
eight nextest workers and original Node file deadlines. JavaScript passes
781/781 in 8.854 seconds; nextest passes 857/857 with four skips; doctests,
224 evaluator cases, two visibility checks and 210 compiler cases pass.

Native execution still takes **78.141 seconds**, exceeding the existing
60-second blocking-suite budget before other phases. This closes the final
candidate's semantic/test-harness failures without closing this timing ticket.
The preceding `35b35dae4` run's two Node file cancellations remain failed samples;
canonical prebuild of both owner binaries and the corrected React passive wait
now qualify under the unchanged deadlines. No limit was increased. Earlier
upstream controls establish an inherited overrun, not a measured attribution
for this final timing. Exact process 385976, command, binary identities and raw
SHA-256 `924f6d4e9a5ce459d35c3a8c65e4f712709a3d53ab666d62be71d386d0f960af`
are retained in the architecture ship run's `final-e94/receipt.md`.

## Native worker-capacity repair — 2026-09-08

At `3891a97b1`, the same warm EPYC lane ran the unchanged native inventory
with eight and sixteen nextest workers. Both ran **865 passing tests and four
skips**, with unchanged assertions, deadlines, and no-fail-fast behavior.
The separate compile preflight took 0.603 s. Native execution fell from
**77.510 s to 39.856 s**; process elapsed time including Cargo setup fell
from 77.907 s to 40.253 s. This is a measured scheduling improvement, not a
product-code speedup. The historical full JUnit contained 600.563 aggregate
test seconds, explaining why eight workers had a roughly 75-second floor.

The full blocking-suite budget remains 60 seconds in total. Native execution
alone meeting that number does not qualify the complete suite. The full script with the initial 16-worker change passed in 96.508 s.
Its compiler phase was still 36.300 s; this is a measured full-script
improvement from the earlier 136.48 s run, not a 60-second qualification. Raw paired logs, JUnit, and process receipts are retained in the
coordinating checkout's `.llp/ship-runs/20260908-loop-and-runtime/`.

The final native worker ceiling is 32, still bounded by the host's available
CPUs and retaining the existing eight-worker floor and explicit override.
One controlled 32-worker run passed the same 865 tests and four skips in
**36.244 s** (36.636 s external elapsed), versus 39.856 s at sixteen workers.
The original eight-worker run was 77.510 s.

The compiler suite now shares one real package build between stale-lock
recovery and the separately reported package-content assertions. Recovery
starts with `dist` removed and must both produce the compiler bundle and
release the dead holder's lock. If recovery fails before the package report
exists, the content check still performs its own pack. The guide-validator
self-test runs its synthetic fixtures directly, and the Node worker check
consumes the built package. Real prepack, package exports, worker operations,
and all-failure reporting remain covered.

On the same EPYC lane, compiler type checking plus all **214 unchanged test
names** passed in **27.023 s**, compared with 36.300 s before these setup
reductions. These phase measurements preserve the complete suite and its
existing deadlines; the 60-second total budget remains an open target.


The failure path also retains independent coverage: when `npm pack` fails,
its original failure is reported and a direct package build restores `dist`
before later checks consume it. A PATH-shim experiment intentionally failed
both real pack attempts and produced exactly **212 passing checks and two
expected packaging failures**. Downstream guide, declaration, template,
compiler-worker and binary checks passed; the compiler bundle remained present
and the build lock was absent. Cleanup now matches only the fixture's unique
launch token and recorded PID. The ordinary one-build path is unchanged.

## Integrated warm result — 2026-09-08

Candidate `43e06fa90`, including the concurrent client-item feature, passes
the complete canonical script in **83.921 s** on the warm EPYC lane.
The actual inventory is 815 Node tests, 865 native passes plus four skips,
doctests, 225 evaluator cases plus two visibility checks, and 214 compiler
checks. Native execution takes 36.118 s. Compiler type checking plus tests
takes 27.235 s. Tools are Rust/Cargo 1.97.0, Node 24.13.1, Bun 1.3.14,
and nextest 0.9.143. The earlier paired worker/compiler wrappers did not
record runtime tool versions; the historical 136.48-second result used
different tooling and is not a controlled percentage comparison.

The preceding `dee96c344` passes in 83.978 s warm and 118.832 s with first
compilation. An initial 43.790-second run lacked Cargo in its non-login PATH,
failed several dependent phases and produced no fresh native JUnit; it is
retained as invalid qualification, not a fast pass. Final hash-bound receipts
and all failures are in `.llp/ship-runs/20260908-loop-and-runtime/`.

This ticket remains open: **83.921 s still exceeds the 60-second total
budget**. Further reduction needs less work in the remaining serial phases
or safe overlap of independent checks. Package rebuild tests mutate `dist`,
so they cannot run concurrently with its readers without first isolating
that fixture ownership. No assertion, deadline, inventory item or budget
was removed to obtain these improvements.

## Latest-state channel qualification — 2026-09-08

The initial local channel run reported 430 JavaScript passes and 29 file
cancellations at the unchanged 10-second deadline; native tests reported
852 passes, 25 failures and four skips. Host load reached 83 on ten available
processors. Owner startup and package-lock deadlines accounted for many reds;
this observation is not a controlled attribution of every failure to load.
Two guide wording regressions were repaired, and a guide edit temporarily
exceeded its byte cap during this already-failed run. The stale recipient-axis
assertion was already repaired upstream and was taken during integration.
Compiler checks passed 227/227 and the evaluator passed 225 cases plus two
visibility checks in that local run. It does not qualify the final source.

The stable integrated candidate was then checked on a separate warm EPYC
`clique-channels` lane with Node 24.18.0, Cargo 1.97.0, Bun 1.3.14 and nextest
0.9.143. Its first original-script run had 842 JavaScript passes and one stale
negative fixture: the forged channel lacked the newly required value declaration,
so it refused before the malformed argument the assertion intended to test.
All 891 native tests, doctests, 238 evaluator cases plus two visibility checks,
and 227 compiler checks passed. No JavaScript file timed out.

After adding a valid value declaration to that fixture, candidate
`ed61dfc23cbfb9b377534922020f8bc75d10df82` passed the focused case and the original
full script: 843 JavaScript passes, 891 native passes, four native skips, and
the same successful remaining checks. Native execution took 35.957 seconds;
the full script took 90.66 seconds. The 60-second total target stays open.
No assertion, timeout, inventory item or budget was removed.

The separate `measure.mjs --check` on runtime-identical `58145f8283` passed:
30.01-second warm build, 2.78-second incremental build, 29.39-second installed
consumer smoke, 0.879-second project check and 0.032/0.033-second doctor samples.
Its exact metric line is in `snapback2/metrics/loop.jsonl`; fixture/document
correction alone did not justify another measurement. Raw failed and successful
logs and process receipts are retained in the coordinating checkout's
`.llp/ship-runs/20260908-ephemeral-api/`.


## Assessment-items integration on the local M1 Max — 2026-09-08

The client readiness/semantic-target/composite-page integration at
`85b1f3080` preserves the original deadlines. The first full parallel run
reported 792 SDK passes, 32 failures and eight cancellations, plus 867 native
passes and 13 failures. Stale guide, corpus, wrapper-pagination and proc
diagnostic expectations were repaired; their assertions now describe the
changed surface. Five run-owned SDK fixture process trees required termination
after their tests timed out. That run remains failed.

A second full invocation used Node file concurrency one and two nextest
workers, without changing the script, inventory, assertions or deadlines.
The native inventory passes **881/881 with four existing skips in 667.166 s**;
doctests, all 238 evaluator corpus cases plus indexed regressions, and all
225 compiler checks pass. The SDK stage, before the fixture-only `85b1f3080` correction, reports
825 passes, seven failures and four cancellations. Two content failures were synthetic resume fixtures missing the new native cursor
metadata; both complete files subsequently pass **67/67 in 9.128 s** with
explicit metadata and unchanged assertions and deadlines.

The remaining SDK failures are the real-session multi-carrier recovery case,
the real-owner schema-successor/lost-ack case, and the exhaustive extent
membership parent with cancelled descendants. All exceed their 10-second
deadline, including focused original-deadline reruns while the two-worker
native run was still active. The real-session case has an unchanged-baseline
timeout recorded earlier in this ticket. The successor case passed in 6.40 s
in this integration's earlier lane run. Neither observation proves a shared
cause for the current timings. No time limit was increased in source, and
the failed invocations are not a passing complete-suite claim.

The root `check-inventories` attempt was also stopped after 13 minutes in its
Snapback 1 diagnostics generator, without a result. This is incomplete legacy
verification, not a Snapback 2 product failure or an inventory pass. Raw logs,
owned-process records and review dispositions are retained in the coordinating
checkout's `.llp/ship-runs/20260908-client-123/` at
`/Users/ccheever/projects/snapback/.llp/ship-runs/20260908-client-123/`
(the primary checkout, not the integration worktree).

After the complete script finished, one separately labelled diagnostic per
remaining case used a 30-second runner allowance without changing repository
source or assertions. All completed successfully: real sessions **16.149 s**,
schema successor/lost acknowledgement **13.467 s**, and extent membership
**14.965 s** (43 passing parent/child tests). These establish functional
completion for those executions; they do not satisfy the original ten-second
deadline or replace any failed sample. No same-machine baseline comparison
attributing the added time was performed. Logs are named
`snapback2-client-123-diagnostic-{sessions,successor,store}.log` in the run
evidence directory.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — reliability and total-loop budget. **Triage priority:** P1.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The original cargo-test scheduling description is historical: test.sh now uses nextest with a bounded worker count and explicit doctests. Later execution records still contain original-deadline failures and full-suite runs above 60 seconds; an isolated pass is not closure.

LLP 1002 §11 records the nextest change and 83.921-second full suite. The latest original-deadline observations above remain evidence. Next: reproduce named timing-sensitive cases on a recorded, bounded-load host and compare complete original-deadline runs; distinguish content failures, infrastructure, and genuine timing regression. Do not increase deadlines or substitute the consumer rung for the full suite.
