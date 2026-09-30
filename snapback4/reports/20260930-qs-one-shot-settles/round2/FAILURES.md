# QS round 2 — failure ledger

## Full suite

Single `scripts/test.sh` invocation, exit 1; exact summary:

```text
== 1 failure(s) in 1280 s
   client tests
```

All other 12 stages pass, including serial client models 79/79. Full-run
failed tests: **ours 0, baseline 8, environmental 0**. The nominal 60-second
budget is exceeded; no full rerun or green full-suite claim.
Client pool: 5,506 pass / 8 fail / 10 existing skips / 0 cancellations.
All eight are baseline; our introduced client failures 0, environmental 0.
The controls and root cause are recorded below.

- expired server replies: recover, keep=false — **baseline**
- expired server replies: recover, keep=true — **baseline**
- expired server replies: close watch, keep=undefined — **baseline**
- expired server replies: close watch, keep=false — **baseline**
- expired server replies: close watch, keep=true — **baseline**
- expired server replies: close client, keep=undefined — **baseline**
- expired server replies: close client, keep=false — **baseline**
- expired server replies: close client, keep=true — **baseline**

## Intentional round 1 regressions

`round1-regressions.log.gz`: 20 expected failures on the merged round 1 SDK,
before product edits. `exact-round1-regressions-complete.log.gz`: the same 19
runtime failures using the exact `a8744099b5` SDK rebuilt in scratch. These
are baseline negative controls for our earlier QS defects, not unexplained
failures of the final implementation. Each runtime case passes on round 2.
The old guide text also fails; the corrected guide check passes.

- online: terminal changes refusal at transport deadline
- app-online: terminal changes refusal at transport deadline
- app-online: terminal changes refusal at authority deadline
- wasm: a time-dependent held miss rereads across its cutoff
- wasm: a held miss dependent on arguments remains retryable
- wasm: a held miss dependent on coverage remains retryable
- wasm: a held miss dependent on membership remains retryable
- process: a time-dependent held miss rereads across its cutoff
- process: a held miss dependent on arguments remains retryable
- process: a held miss dependent on coverage remains retryable
- process: a held miss dependent on membership remains retryable
- app-wasm: a time-dependent held miss rereads across its cutoff
- app-wasm: a held miss dependent on arguments remains retryable
- app-wasm: a held miss dependent on coverage remains retryable
- app-wasm: a held miss dependent on membership remains retryable
- app-process: a time-dependent held miss rereads across its cutoff
- app-process: a held miss dependent on arguments remains retryable
- app-process: a held miss dependent on coverage remains retryable
- app-process: a held miss dependent on membership remains retryable
- guide: the client contract names only proven permanent held refusals

## Preparatory failures — ours

- `guide.log.gz`: `client::existence_card_and_starters_teach_the_sdk_words`
  failed the unchanged 1,200-word cap (105 passed / 1 failed).
- `guide-final.log.gz`: the same case failed after an insufficient first trim
  (105 passed / 1 failed). Both are ours. `guide-pass.log.gz` runs the entire
  guide after the final trim: 106/106. No test or budget was weakened.
- `exact-round1-build.log.gz` and `exact-round1-build-pass.log.gz`: scratch `tsc`
  reported TS2307 for the ignored generated wasm module from `web-wasm.ts`,
  `web-worker-runtime.ts`, and `web.ts`. The first copy attempt named a
  baseline scratch directory that was unavailable. Supplying the generated
  wasm module in the scratch source produced `exact-round1-build-complete.log.gz`
  with a successful typecheck/build.
- `exact-round1-regressions.log.gz`: one file-level test failure before scenarios
  ran, because the scratch dist lacked the generated wasm JavaScript module.
  Copying the generated module to dist fixes setup; the complete replay
  records the intended 19 assertion failures, not a setup failure.
- Two edit commands used a Snapback-relative working directory with
  repository-relative paths and stopped with `FileNotFoundError` before
  mutation. Retried from the repository root. An empty filtered test
  invocation from the first attempt is not counted as verification.

No preparatory failure is attributed to infrastructure or relabeled as a
passing invocation. Successful affected runs are separate evidence.

## Expired-server-reply baseline investigation

`expired-server-followup.log.gz`: 12 tests, 6 pass / 6 fail on round 2.
`expired-server-baseline.log.gz`: 12 tests, 6 pass / 6 fail on the merged pre-fix
SDK (17ca8a3809). Both fail the same six cases:

- recover, keep=false
- recover, keep=true
- close watch, keep=undefined
- close watch, keep=true
- close client, keep=undefined
- close client, keep=true

`expired-server-baseline-traced.log.gz`: 12 tests, 4 pass / 8 fail on that same
baseline, with only timer creation stacks printed (no scheduling or callback
replacement beyond the original fixture). Its failures:

- recover, keep=undefined
- recover, keep=false
- recover, keep=true
- close watch, keep=undefined
- close watch, keep=false
- close client, keep=undefined
- close client, keep=false
- close client, keep=true

All are **baseline** fixture failures. The stack-only run identifies Undici
`Parser.setTimeout`/`resumeH1` 1,000 ms socket timers passing the fixture's
AsyncLocalStorage filter. These yield `1000 !== 25` or two captured timers
instead of one. The union reproduces every full-run expired-reply failure.
No product or fixture fix is claimed. Follow-up:
`issues/20260930-snapback4-expired-watch-captures-transport-timers.md`.

## Final evidence packaging — ours

The staged diff check exposed trailing spaces emitted by Node's assertion
formatter and context lines in the saved diff. Source-only diff checks had
passed. Preserved exact evidence bytes as gzip archives instead of editing
logs; final staged diff check passes. Product/test inputs are unchanged.
