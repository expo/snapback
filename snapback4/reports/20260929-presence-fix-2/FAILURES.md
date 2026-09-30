# Development and negative-control ledger

- B1 before fix: Astra's copied admission reproduction failed twice, native
  and wasm, with one-shot absent instead of partial (`b1-before.log`).
- The first shared-predicate implementation left routing fixture caches behind
  when a test replaced its queue reader. That development run had failing
  routing assertions and was interrupted. It was corrected to pass the returned
  footprints directly into the shared predicate. Its log was superseded.
- A subsequent affected run had 240 pass / 2 fail: two standalone remembered-read
  fixtures referred to an undefined test `reads` variable (`b1-after.log`).
  Corrected fixture injection; `b1-final.log`: 242 pass / 0 fail.
- Type negative control: before fixes, 1 pass / 3 fail (`types-before.log`):
  generic consumer failed TS2345, nullable consumer incorrectly compiled, and
  the covariance/shape test failed. The missing-field rejection already passed.
- Two discarded type approaches failed the new tests (`types-after.log`,
  `types-after2.log`): intersections around anonymous arms still broke the
  constrained generic; conditional Extract filtering also made unknown erase
  absence. Neither was committed. Named interfaces with fixed intersections
  passed all four checks (`types-final.log`).
- The reconstructed nullable runtime fixture initially used a page expression
  directly inside a conditional; Quarry rejected it (`types-runtime.log`).
  Using the ordinary conditional statement with two return branches generated
  the intended Row[] | null type; `types-runtime-final.log`: 13 pass / 0 fail.
- Before adding discovery aliases, the three requested searches returned no
  card: guide client scope 9 pass / 3 fail (`guide-before-aliases.log`). After
  aliases: whole guide 105 pass / 0 fail (`guide-final.log`).
- First blocking run: the client pool reported 4,784 pass / 2 fail / 9 skipped.
  The whole command ended `== 1 failure(s) in 5645 s`; all 79 final model
  checks passed. Both client failure counts represent one subtest and its parent: online,
  keep=undefined, chat history, peer sync. The actual error was
  `page.evaluate: TypeError: window.replay is not a function`, before any read,
  loading or mount assertion ran. One isolated run and 12 bounded repeats
  passed (six checks each), so they did not establish a product failure.
  The temporary Vite server could send a cold dependency-optimization
  full-page reload after the harness's initial readiness check. Its fixed
  replay page now uses `server.hmr: false`; Vite's hot channel suppresses that
  reload, and no files are edited during a replay. No product code, history,
  assertion, timeout or test count changed for this setup repair.
  All 66 checks in the complete React replay file passed after the repair
  (`react-harness-fixed.log`). The original diagnostic and whole-run result
  are preserved in `full-suite-first.log`.
- Second blocking run ended `== 1 failure(s) in 5222 s`: the client pool
  had 4,786 pass / 0 fail / 9 optional skips, and all 79 final model checks
  passed. `snapback4::dev_refusals` had 20 pass / 1 fail.
  `sigint_without_worker_flushes_refusals_while_a_poll_is_held` received a
  refusal line split by raw `SNAPBACK4_THREAD_EXIT` writes. The exact stderr
  in `full-suite-second.log` shows `dev refusal: addSNAPBACK4_THREAD_EXIT...`
  followed on a later line by the rest of the refusal. `writeln!` formatted
  directly into stderr in pieces, and lifecycle intentionally bypasses Rust's
  stderr lock for signal/panic safety. The console now formats one complete
  line and passes it to write_all; lifecycle remains unchanged.
  A deterministic injected writer reproduced the split before the repair
  (0 pass / 1 fail; 37 fragments instead of two intact lines), then all four
  console aggregation tests passed. Logs: `console-before.log` and
  `console-after.log`. Two initial exact-name filters selected zero tests
  because the unit is nested under serve; both setup logs are preserved and
  neither counts as a pass (`console-filter-setup.log`,
  `console-filter-setup2.log`). The repaired live refusal/shutdown suite then
  passed all 21 tests (`dev-refusals-after.log`), including the exact SIGINT
  case that failed in the second full run.


- Third blocking run ended `== 1 failure(s) in 6300 s`; all 79 final
  model checks passed. The client pool finished with 4,783 pass / 3 fail /
  9 skipped. It reported failures in
  both `local close cancels a {mutation,upload} caller without aborting its
  committed response` cases. Both final diagnostics are the existing
  `close waited for an effect body` 500 ms assertion.
  An isolated two-case repeat passed (`local-close-reproduce.log`). The whole
  app file then reproduced the upload failure (77 pass / 1 fail,
  `app-reproduce.log`): its existing 500 ms close deadline elapsed. A temporary
  device-call trace, retaining the same assertions and deadline, passed the
  whole file (78 checks, `app-trace.log`) and 20 isolated two-case repeats
  (`local-close-trace-*.log`). These are diagnostic repeats, not substitutes
  for a complete blocking run. No close implementation or deadline has been
  changed on this evidence. Two additional whole-file trace repeats produced
  78 pass / 0 fail, then 77 pass / 1 fail. The failing trace shows the upload
  reaching core.close within 3 ms, with all outstanding device calls already
  complete; core.close then takes 807 ms. This is beyond the unchanged 500 ms
  app deadline, independently of the held response. Logs:
  `app-trace-repeat-1.log`, `app-trace-repeat-2.log`. Host load observed during
  diagnosis was 35.51 / 61.94 / 60.37 (1 / 5 / 15 minutes), with 18 available
  CPUs. This observation explains why a scheduling delay is plausible; it
  does not turn the failed blocking run into a pass. A final trace including
  native child kill/exit/close events passed 78/78 (`app-process-trace.log`);
  its closes took about 4 ms and 3 ms. The temporary trace source was removed;
  `local-close-diagnostic.patch` preserves how it was obtained. Its diagnostic
  CLOSE_TIMEOUT line is emitted whenever the 500 ms timer expires, even after
  the race has already succeeded; only a failed test indicates a missed
  deadline. No diagnostic source remains in the test inventory.


- The third run also reported the HMAC/non-UTF8 route case failing after
  10.236 seconds. Its final diagnostic is `timed out: route host listening`,
  before any request or HMAC assertion. An immediate exact
  case repeat passed (`hmac-reproduce.log`, 1 pass / 0 fail); this is diagnostic
  evidence only and does not qualify the failed full run.


- Fourth blocking run ended `== 1 failure(s) in 6941 s`; all Rust targets
  passed, the client pool had 4,785 pass / 0 fail / 1 cancelled / 9 skipped,
  and all 79 final models passed. Both local-close tests and the HMAC case
  passed with their original limits. The one cancellation was the native
  mixed-evidence test: `test timed out after 240000ms` (242340.744917 ms
  including cleanup). Its still-running continuation then logged 300 histories
  with 43 mismatches; the wasm batch logged 300 with zero mismatches. Those
  post-timeout observations are preserved, not discarded. The timed-out test
  owns a mocked Date.now, whose cleanup can overlap its unfinished async body;
  an isolated full-count repeat then passed all 300 histories in 144267.468542
  ms, with zero mismatches and no cancellation. Every history is recorded in
  `mixed-native-repeat-process.json`; `mixed-native-repeat.log` has the result.
  This repeat did not reproduce a correctness mismatch. Counts and the
  240-second timeout remain unchanged. Evidence: `full-suite-fourth.log`.
- Archiving the fourth log initially used a repository-root relative path
  from inside snapback4 and stopped before mutation. It was corrected from
  the root; the diagnostic test itself launched with the correct paths.

The supplied review directory contains consumer.ts, nullable-consumer.ts and
review-admission-insert.test.mjs, but omits review-nullable-array.test.mjs.
Its runtime log, review description and generated API were present. The
permanent read-nullable-array.test.mjs reconstructs that generated-query case
and asserts its legitimate [], null and nonempty results; the type test is the
negative regression for the former false null-only promise.

During the fifth run, the Linux qualification fixtures progressed unusually
slowly through short local Node stand-ins. A one-second macOS sample caught
a suite-owned subprocess at `_dyld_start` in all 886 samples, with 112 KB
physical footprint and no binary images available yet, before JavaScript
startup. This diagnostic does not modify or bypass a test; the complete run
completed unchanged with `== 0 failure(s) in 5348 s`. Evidence:
`qualification-node-startup.sample.txt` and `full-suite.log`.
