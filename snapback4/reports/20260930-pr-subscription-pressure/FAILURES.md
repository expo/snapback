# Failure ledger

All logs are retained. Expected failing main controls are distinguished from
qualification failures. No test count, timeout, work limit or wasm budget was
relaxed.

- `causal-main.log.gz`: two expected baseline failures (default retention and
  `keep: true` lose the queued history). The fixed deterministic cases pass.
- Initial convergence command was launched from the repository root with paths
  relative to `snapback4`; shell redirection failed before tests ran. Ours.
- `convergence-main.log.gz`: two fixture setup failures. Missing comma between
  persona names. Ours; compiler `check --json` identified it.
- `convergence-main-2.log.gz`: two fixture setup failures. Read-through foreign keys
  needed `immutable`; the word index needed its positional room key. Ours.
- `convergence-main-3.log.gz`: missing Vite alias for `react/jsx-dev-runtime` caused
  both browser readiness waits to fail. Ours.
- `typecheck.log.gz`: exact optional property types rejected explicit `undefined`
  for the episode queue field. Ours; annotated that internal field accurately.
- `convergence-main-4.log.gz`: both scenarios converged, then teardown closed the
  browser before closing clients. Ours; registered client cleanup first, keeping
  every process-render publication promise alive through teardown.
- `convergence-main-final.log.gz`: both natural baseline histories converged with
  zero gaps; process decoration observations did time out. This is evidence,
  not a reproduction claim for the original M8 history gap.
- `devices-main.log.gz`: four expected baseline assertion failures: queued history
  loses data (wasm/process) and scope removal waits for a read slot (wasm/process).
  All four corrected cases pass. Original main SDK modules were independently
  transpiled from commit `2cb2b5f141befd4c5dfd6afdc6c0725867f3c747`; devices and
  server are unchanged real builds. There were no cancellations or timeouts.
- `affected.log.gz`: 303 tests, 293 passed, 10 failed. Ours: four membership-removal
  React child cases (and their four parent cases), plus the wasm/process held
  removal cases in `answers-stay-review`. They previously required retaining
  removed history until evaluation/deadline. The user requires immediate
  membership withdrawal; they now explicitly assert withdrawal/render removal.
  Plain revalidation, edits, deletes, expiry, refusals and all other assertions
  remain. `affected-corrections.log.gz` passes 376/376 and
  `review-corrections.log.gz` passes 38/38.
- `guide.log.gz`: two wording checks failed after prose compression removed pinned
  wording about pending predictions and delivery ownership. Ours; restored the
  exact teaching phrases and kept the 130-line/1,200-word card budgets.

- `devices-main-final.log.gz` repeats all four detecting controls with explicit
  timeout-cause capture; all four fail the intended assertions on main.
- `convergence-controlled-main.log.gz`: two expected baseline failures. The final
  dual-offline harness delivers a real concurrent peer edit while both history
  completions are held. Both histories withdraw once on each host; convergence
  still eventually has all 42 rows exactly once. This same final harness passes
  in `pressure-qualified.log.gz`, 12/12 cases across all three pressure files.
- LL timing is not a pass/fail assertion: initial process-contention p95 rose
  218.916→358.139 ms, and one additional fixed control reached 472.833 ms as host
  load rose. No samples were removed. The last adjacent main/fixed pair measured
  249.785→220.074 ms. Every cell has zero timeouts. This variation and its limits
  are disclosed in REPORT.md, not labelled a deterministic product failure.

The once-run complete-suite result and any further failures are recorded in
REPORT.md and the complete-suite log.


## Once-run complete suite and corrections

Exact summary: `== 1 failure(s) in 1376 s`, failed step `client tests`, exit 1.
All 22 failed tests are ours. The twenty membership expectations now assert the
requested immediate boundary; the public API example/export mismatch is fixed;
the new real-time convergence assertion now distinguishes legitimate active
expiry from queue-only withdrawal. Affected corrections pass 87/87, whole guide
105/105. The complete suite was not rerun. Every exact failed name follows:

| Failed test | Classification |
|---|---|
| wasm: apply revocation, keep=undefined, held | Ours |
| wasm: apply revocation, keep=undefined, throw | Ours |
| wasm: apply revocation, keep=undefined, unavailable | Ours |
| wasm: apply revocation, keep=undefined, retryExhausted | Ours |
| process: apply revocation, keep=undefined, held | Ours |
| process: apply revocation, keep=undefined, throw | Ours |
| process: apply revocation, keep=undefined, unavailable | Ours |
| process: apply revocation, keep=undefined, retryExhausted | Ours |
| wasm: keep=undefined across revoke publishes no loading and replaces the old answer | Ours |
| wasm: keep=undefined across leave publishes no loading and replaces the old answer | Ours |
| wasm: keep=undefined across refusal publishes no loading and replaces the old answer | Ours |
| process: keep=undefined across revoke publishes no loading and replaces the old answer | Ours |
| process: keep=undefined across leave publishes no loading and replaces the old answer | Ours |
| process: keep=undefined across refusal publishes no loading and replaces the old answer | Ours |
| wasm: keep=true across revoke publishes no loading and replaces the old answer | Ours |
| wasm: keep=true across leave publishes no loading and replaces the old answer | Ours |
| wasm: keep=true across refusal publishes no loading and replaces the old answer | Ours |
| process: keep=true across revoke publishes no loading and replaces the old answer | Ours |
| process: keep=true across leave publishes no loading and replaces the old answer | Ours |
| process: keep=true across refusal publishes no loading and replaces the old answer | Ours |
| README TypeScript examples compile and call every public function | Ours |
| wasm: two offline devices, 124 mounted observations each, exactly-once history | Ours |

Additional post-suite detecting probes:

- `active-probe.log.gz`: two expected harness assertion failures with an intentional
  1.1-s active hold. Both hosts time out in-flight, not queued. Ours: the original
  unconditional no-gap assertion contradicted the preserved active budget.
- `contention-probe.log.gz`: one wasm failure with the same four/zero gap counts as
  the full run. Captured queue=false, in-flight=true and 1,004.6 ms of active hold;
  process passes. Ours, same overbroad harness assertion; load is an input rather
  than a reason to classify the failure as environmental.
- `active-qualified.log.gz`: two harness-correlation failures after splitting active
  from queued timeouts. Ours: recorded the preceding publication index before the
  source's withdrawal callback notified subscribers. Corrected to the next index;
  `active-final.log.gz` passes 2/2, retaining each genuine active expiry and all DOM
  convergence assertions.

Baseline qualification failures: 0. Environmental qualification failures: 0.
Expected main-control failures demonstrate the bug and are listed separately.

- `main-recheck.log.gz`: the final convergence assertion fails on both real hosts
  against recorded main, with queued=true/inFlight=false at each history timeout.
  Expected baseline detecting control, not a fixed-product qualification failure.

- The staged whitespace check flagged trailing spaces in raw Node failure output
  and blank EOF lines from Cargo. Ours, evidence packaging. All original logs are
  now gzip-compressed byte-for-byte with digest verification; no diagnostic text
  was stripped or rewritten. The final staged whitespace check passes.
