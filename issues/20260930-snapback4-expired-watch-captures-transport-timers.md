# Snapback 4: expired-watch fixture captures transport timers as retry backoff

- **Opened:** 2026-09-30, QS round 2 full suite.
- **Status:** Open.
- **Scope:** `snapback4/packages/snapback4/test/expired-server-watch.test.mjs`.
- **Classification:** Baseline fixture failure at merged commit `17ca8a3809`
  (parents QS round 1 `a8744099b5` and main `0dad042375`).
- **Related:** [earlier timing repair](closed/20260927-snapback4-expired-watch-retry-timing-flaky.md).

The fixture's AsyncLocalStorage filter admits unrelated transport timers.
Its first captured timer can be Undici's 1,000 ms socket timer, causing
`1000 !== 25` at line 79; alternatively it sees two timers instead of one
at line 78. This is not evidence of incorrect product expiry backoff.

QS round 2's full suite reported eight failures: recover with keep=false/true,
close watch with keep=undefined/false/true, and close client with each keep
setting. An ordinary focused run on both QS round 2 and the pre-fix merged
SDK reproduced six failures. A second baseline run that only prints timer
creation stacks reproduced eight, including both keep=false closure cases;
the union covers all eight full-run cases. The failing set depends on timing.
Stacks name `undici/lib/dispatcher/client-h1.js:264` (`Parser.setTimeout`),
`resumeH1`, and the dispatcher client. No QS product or fixture source was
changed in these controls.

Evidence: [round 2 report](../snapback4/reports/20260930-qs-one-shot-settles/round2/REPORT.md),
`expired-server-baseline.log.gz`, `expired-server-baseline-traced.log.gz`, and
`expired-server-followup.log.gz` beside it. The diagnostic loader
`trace-expiry-timers.mjs` records stacks without changing delays or callbacks.
`QS_MAIN_DIST` with the existing report `baseline-loader.mjs` loads the
compiled merge SDK while leaving the working build intact.

Repair the fixture's timer ownership boundary so it controls only the
watch's expiry backoff. Preserve exact 25/50/100/200/400/800/1000/1000 delays,
single-flight and single-timer assertions, forced sync invalidation, no
expired publication, complete/fresh recovery and both close paths. Do not
weaken assertions or change product backoff to accommodate transport timers.
