# Failure ledger

Classification is relative to the starting commit: **baseline** means present
before SL changes; **ours** means introduced by this work or its experiment
harness; **environmental** means an external runtime/host failure. A script
footer counts failing stage groups, not individual tests. Complete names,
stacks and cascades remain in each raw log and adjacent `.summary.json`.
This ledger records the completed qualification matrix and all diagnostic attempts.

| Record | Classification | Every failure family and disposition |
|---|---|---|
| Historical attempts 1–4 | Baseline | Every available failed execution, including cancelled descendants, is preserved in `attempt-{1,2,3,4}-publication-dry-run.summary.json`; the [historical table](HISTORICAL.md) maps each family to its cause, prior fix or open ticket. Attempt 4 is partial. |
| `baseline-idle` | Baseline | Clique `application_fixture` reader wall ratio 4.1036 > 3. Paired thread-CPU control replaces the scheduling-sensitive ratio; same 3× bound. |
| `baseline-moderate` | Baseline | Doctor wrong-project snapshot race; online revocation `keep=undefined, held`; wasm population-growth replay refusal census. Each is addressed by an explicit fixture/state barrier. |
| `baseline-heavy` | Baseline | Online revocation `keep=undefined`, held and throw; process read-liveness `keep=undefined` and false; process pre-reset publication `keep=undefined`; both web orphan response transports; web parent timeout, active fresh-orphan cancellation and seven subsequent closed-page failures; local 5,000-history model cancellation at 240 s. Full names/stacks are in `baseline-heavy.summary.json`. |
| `baseline-heavy`, `per-row-retry` | Environmental, inherited fixture trigger | Five asynchronous post-test exceptions in Node 24.13.1 bundled undici (`parser.deref()` is undefined), producing one failed test-file record although all named cases passed. The custom test transport now uses the already-pinned SDK dispatcher with the missing guard. |
| `baseline-slow` | Ours — harness | Aborted after 16 child threads escaped inherited taskset affinity to CPUs 0–15. Initial taskset-only runs are diagnostic, not confinement-qualified. Corrected inherited kernel guard controls all subsequent runs. Rust passed before the abort; no whole completion claim. Strace also added substantial runtime overhead, so the final startup experiment uses the validated exec-only wrapper. |
| `control-baseline-heavy` | Baseline, intentional diagnosis | Both original orphan-response cases and their parent fail. No mutation arrives during an additional 60-second observation; trace proves an unsolicited watchdog probe discovered B before orphan release. Heartbeats fix the fixture premise without extending its response wait. |
| `control-token-before` | Baseline, intentional reproduction | Original ownership test fails `rollback: E_STORE: database is locked` with 1500 ms child-start delays. Same injection passes with the corrected output barrier. |
| `control-clique-regression` | Ours, expected negative control | Deliberate 10 ms celebrity CPU burn fails at 12.1146×. Exact source bytes restored and all three Clique checks pass afterwards; this failure proves the guard still detects CPU regressions. |
| `control-typing-clock` | Ours | New paused-clock candidate reaches successful expiry checks but cannot join cleanup's frozen one-second retry; diagnostic 70-second timeout. Resume the clock after semantic assertions. |
| `focused-clients` | Ours | The same stuck typing file family was terminated after diagnosis, yielding one failed file record; the other 206 checks pass. No live descendant remains. Corrected typing passes both age cases; the seven affected files then pass all 208 checks under 48 busy workers. |
| `control-retained-heavy` | Baseline product defect, focused reproduction | 100 unchanged wasm R5 repetitions: 85 pass, 15 fail. Captured server sequence 5 empty publication before device watermark 4 applies leave; next local answer restores 25 retained rows. Full traces and all failure windows are preserved; product ticket remains open. |
| `qualified-moderate` client stage | Baseline product defect | `R5 history wasm` fails the unchanged `assert.ok(!deliveries.includes(0))` at line 838, reproducing the existing transient-empty issue. All other client cases and all 79 models pass; exact footer `== 1 failure(s) in 2227 s`. Added Linux contention evidence to the open product ticket; no fixture or timeout adjustment. |
| `qualified-heavy-1` retry case and teardown | Baseline fixture premises, exposed in SL candidate | `process keep=undefined: a due completion preserves a newer answer and retries` fails `paced retry publishes the current answer`, then cleanup stalls on a mocked one-second sleep. Inspector records clock 25, queued timer 1025, no network request. Diagnostic tick 1000 releases cleanup; original assertion failure is reported and all remaining cases execute. No qualification claim for this intervened run. A 750 ms continuation-delay control reproduces the original assertion with the old 60-turn wait and passes with the real retry event; cleanup is fixed after closing begins. |
| `qualified-heavy-1` Rust HTTP rate refusal | Baseline fixture race | `rate_and_input_refusals_are_http_200_failed_under_dev_and_serve`, spacing 7, receives `sent` instead of `E_RATE_LIMIT`. The real token bucket refills in the scheduling gap between direct drain and HTTP admission. Per-instance test clock applied after the whole attempt ended; all 14 affected HTTP tests pass under 48 busy workers. |
| `control-retry-before` | Baseline premise, intentional negative control | With a 750 ms delayed continuation, the original sixty-turn wait advances mock time to 25 before the 25 ms retry is installed. The original paced-retry assertion fails. Same injection with the event barrier passes; both controls retain semantic assertions and use corrected cleanup to report promptly. |
| `qualified-idle` Rust guide | Ours | `familiar::every_moved_fact_has_its_why_or_details_home`: `reads-11 lost its Details home`. The guide was corrected but its fact registry still held the old claim. The fix changes that fact's text, preserving all 133 entries and the exact presence assertion. Whole run completed with this sole failure (`== 1 failure(s) in 1728 s`); the corrected assertion passes. |
| `qualified-slow` mixed-evidence oracle | Baseline aggregate guard | Process 300-seed case cancelled at 600331 ms; three hosted schedules per seed and 300 ms device startup exceed the inherited one-schedule allowance. Its uncancelled body continues after mock-clock teardown and prints 60 failed-seed records; all are retained. Candidate budgets two seconds for each of three schedules and checks cancellation before new schedules. Final full-count slow evidence remains required. |
| `qualified-heavy-2` ownership stdin | Baseline fixture race | `identity::device_cannot_clear_a_running_servers_rows` writes after spawn; correct early device refusal closes the pipe and triggers `Broken pipe` before the assertions. Control confirms child status 2 and `E_STORE_BUSY` before the old write fails. Preload the same command before launch; preserve refusal/status/row/side-table checks. Exact footer `== 1 failure(s) in 3705 s`; every client and model passes. |
| `control-identity-before` | Baseline premise, intentional negative control | Force child exit before the original parent write. Captured status 2 and `E_STORE_BUSY`, then the original `write_all().unwrap()` fails with `Broken pipe`. The same destructive input is preloaded before launch in the corrected fixture; all four outcome assertions remain. |

The historical Mac close/cleanup stalls are still [open](../../../issues/20260929-snapback4-browser-close-stalls-under-publication-load.md).
The real retained-history transient-empty assertion is unchanged and its
[product ticket](../../../issues/20260929-snapback4-retained-history-transient-empty.md)
remains open. Passing Linux repetitions do not resolve either historical cause.


`qualified-heavy-3` additionally exposes the unchanged **ordinary search
generated oracle process: 300 seeds**, seed **130**, exact next-page equality.
After reopening without reset, the continuation repeats page one. The aggregate
case finishes in 285.693 s, below its guard. The completed diagnosis below
identifies a product defect, not a timeout. The raw action trace is retained in
the whole log.

`control-search-heavy` reproduced that same seed-130 exact-page failure on
process repetition 49 (99/100 process and 100/100 wasm cases pass). The first
control's default error formatter omitted its appended trace (**ours**, diagnostic
logging), so the trace is explicitly emitted in the second focused control.


Search diagnosis is complete: `qualified-heavy-3`, `control-search-heavy`
(process repetition 49), and `control-search-until-failure` (repetition 154 after
153 passes) expose a **baseline product defect**. A prior reconnect increments
the cursor's in-memory link revision to two; reopening resets it to zero and
restarts pagination, despite unchanged store/generation/membership/audience.
`control-search-heavy-2` passed all 200 cases; that does not resolve the defect.
The deterministic `control-search-reconnect` forces the legal reconnect before
minting the cursor: all five process and five wasm cases fail the unchanged
page-one assertion. All ten failure blocks are in its `.summary.json`; field
comparisons are in `search-reconnect-analysis.json`. The
[product ticket](../../../issues/20260930-snapback4-search-cursor-reopen-restarts.md)
remains open, with no change to the whole-suite oracle.


`qualified-heavy-4` has a **baseline product framing failure** in
`shutdown::sigterm_without_worker_flushes_refusals_while_a_poll_is_held`.
A raw thread-exit diagnostic splits the refusal line while `writeln!` formats
its fragments; the unchanged counted-line assertion fails. The raw block is
`refusal-interleaving.txt`. The product correction and interleaving regression
validated after that full run are described below; the guard is not increased.


The fourth heavy attempt ended with that sole product-framing failure:
`== 1 failure(s) in 3649 s`; all clients and all 79 models pass. The **baseline,
intentional reproduction** `control-console-before` fails the new interleaving
regression against the original writer (exit 101). Buffering the complete line
before writing fixes the observed formatting-fragment race: all four console
checks and all 20 real refusal/shutdown checks pass under 48 busy workers. No
existing shutdown assertion or guard was changed. The subsequent full matrix
uses the corrected source; all prior failures remain in their original records.

`qualified-heavy-6` reproduces the **baseline R5 retained-history product race**
on the same console candidate. The wasm case fails `assert.ok(!deliveries.includes(0))`
at line 838 in 412.423534 ms. The client stage reports 5,196 passes, one failure,
ten inherited skips and no cancellations. All 79 subsequent models and all
4,342 Rust checks pass; exact whole footer: `== 1 failure(s) in 3515 s`.
This attempt does not count toward the three heavy passes. No source, timeout
or assertion is changed in response; the existing open product ticket records
the recurrence.

`qualified-heavy-7` additionally exposes the **baseline stderr-order fixture
failure** in `changed_default_rechecks_unchanged_cap`, shared with
`changed_default_rechecks_unchanged_unique_index`. The complete `E_ADOPT` exit
record is followed by a valid host-capacity diagnostic. The helper parses the
entire stderr suffix after `reason=` as JSON and fails with `trailing characters`
at line 2, column 1. The [observed block](exit-record-order-failure.txt) is
preserved. The host-capacity line uses the bounded asynchronous diagnostics
writer; the exit line writes directly. The guide specifies individual event
lines, not relative ordering. The whole attempt completes with `== 1 failure(s) in 3466 s`: all clients and
all 79 models pass; Rust has 4,341 passes and that one failure. After completion,
the original helper fails both `control-exit-record-before` cases (expected
baseline reproduction, exit 101), while the same trailing-line injection passes
both corrected cases. All 82 check tests and all 27 strengthened ownership
tests pass under 48 busy workers; both changed-default tests also pass with
300 ms child starts. The direct ownership assertion passes with all eleven
child execs delayed at least 1500.074846 ms. No product behavior or timeout
is changed by these final fixture corrections.


`qualified-heavy-8` exposes a **baseline browser-fixture teardown race** in
`identity incarnation refuses publicly without custody (Worker)`. Its admission
assertions complete, but `route.fetch` resumes after the browser closes and
Playwright reports the closed target at `admit-before-identity.test.mjs:120`.
The client stage has 5,196 passes, one failure, zero cancellations and ten
inherited skips. Rust passes all 4,342 checks. All 79 models pass, and the exact footer is `== 1 failure(s) in 3950 s`.
All 48 workers survive; source remains unchanged throughout that attempt.
After completion, `control-route-drain-before` reproduces the same closed-page
error (one failure, exit 1, 3.540 s), while `control-route-drain-after` passes
(one pass, 3.721 s). The correction then waits for route callbacks while the
browser remains live; it does not use
Playwright's `ignoreErrors` behavior or change an admission assertion.

All 59 admission tests subsequently pass under 48 busy workers and under
300 ms delayed startup, with zero skips, cancellations or asynchronous errors.
The callback correction is test-only; the final whole matrix starts at
`qualified-heavy-9`. The earlier failed attempt remains failed evidence.

`qualified-heavy-9` completes with `== 0 failure(s) in 3513 s`: **ours 0, baseline 0,
environmental 0** in this attempt. All 13 stages pass, including Rust 4342,
clients 5197 and models 79; inherited ignores/skips remain 33/10. All 48 busy
workers survive, and the tested source digest is unchanged. This is the first
final-source heavy pass; it does not close either reproduced product defect.

`qualified-heavy-10` exposes the **baseline R5 product invariant failure on
the process host**. The exact assertion is again `!deliveries.includes(0)` at
`retained-history.test.mjs:838:46`, after 548.741058 ms. This is not a timeout.
Rust passes; clients 5196 pass, one fails, ten inherited skips and no
cancellations. All 79 models pass; exact footer `== 1 failure(s) in 3512 s`. All 48 workers
survive and source remains unchanged. The existing open ticket now covers both
hosts; the subsequent process trace proves the same publication ordering. No R5 assertion, SDK query source or timeout is changed.

`control-retained-process-heavy` is a **baseline product-defect reproduction**:
82 of 100 repetitions pass, 18 fail the original empty-delivery assertion; no
skips, cancellations or asynchronous errors. Its 52.616-second trace shows
server sequence 5 publishing empty before the device applies the leave at
watermark 5, followed by 25 retained rows. All 18 timelines/windows are retained.
The final-source matrix resumes without a source change or assertion adjustment.

`qualified-heavy-11` completes with `== 0 failure(s) in 3738 s`: **ours 0, baseline 0,
environmental 0** in this attempt. Rust 4342, clients 5197, models 79 and wrappers
9 pass, with all original full-count histories and seed sets. All 48 workers
survive and the final-source digest remains unchanged. This is the second
final-source heavy pass; the earlier product failures remain failed evidence.

`qualified-heavy-12` completes with `== 0 failure(s) in 3514 s`: **ours 0, baseline 0,
environmental 0** in this attempt. All 13 stages and every full-count history
and oracle pass; Rust 4342, clients 5197, models 79 and wrappers 9. All 48
workers survive and source remains unchanged. Together with attempts 9 and 11,
this supplies the three required final-source heavy passes. Attempt 10 remains
a recorded product failure between those passes.

`qualified-slow-3` completes with `== 0 failure(s) in 2494 s`: **ours 0, baseline 0,
environmental 0**. Rust 4342, clients 5197, models 79 and wrappers 9 pass; all
original full-count histories/oracles pass and source remains unchanged. The
startup trace has 14,776 resumed child execs, all delayed at least 300.000010 ms;
six child exec events end before resume. The subsequent complete `guide-full`
passes 99/99 with no ignored cases or failure.

`final-unconfined` is the last whole-suite execution and completes with the exact
footer `== 0 failure(s) in 1216 s`: **ours 0, baseline 0, environmental 0**.
All 13 stages pass: Rust 4342, clients 5197, models 79, wrappers 9. Inherited
ignores/skips remain 33/10; no cancellation or asynchronous error occurs. Every
full-count model and oracle passes. The source hash remains unchanged, and the
actual inventory is 96 CPUs, 24 Rust processes and 24 client-file slots. No load
generator, affinity guard or startup wrapper is active. No subsequent whole
run occurs. `validate-evidence.py` validates the entire required matrix and
writes the source/log/trace-bound `qualification.json`.
