# Round 1 failure ledger

No failure is silently relabelled by a passing rerun. `ours` includes round 0
product bugs this lane is repairing, as well as mistakes in this round's tests.

## Negative controls and exploratory runs

- `reproduce.log`, `reproduce-2.log`: native overlap fails as expected (**ours,
  round 0 product defect**). The dedup fixture initially used a snapshot page
  without snapshot ownership and received `E_GENERATION` (**ours, fixture setup**).
  Online checks ran before the production probe backoff completed and therefore
  were insufficient negative controls; corrected before implementation.
  Initial file creation/build commands also used the wrong working-directory
  prefix; they created no implementation files and were corrected.
- `reproduce-valid.log`: native overlap and input collision fail (**ours,
  round 0 defects**). Online checks still precede probe completion.
- `reproduce-all.log`: all four requested negative controls fail (**ours,
  round 0 defects**): native accepted write missing, conflicting deferred input
  accepted, executed online intent becomes failed, and settled online intent
  emits a false timeout. Fixed; `races-expanded.log` passes 9/9.
- `grok-reproduce.log`: wasm and Worker bind to the staged replacement and
  reach transport (the original server returns `E_STORE_REPLACED`), instead of
  refusing admission; native generation and incarnation cases emit family
  `schema` instead of `store` (**ours, round 0 defects**).
- `grok-real-replacement.log`: both web hosts actually execute on a second
  server and return `sent` (**ours, round 0 binding defect**). Fixed.
- `grok-fixed.log`: both web assertions pass and no POST occurs, but teardown
  disposes a routed `/changes` request, failing both tests (**ours, fixture
  cleanup**). The fixture now aborts its irrelevant changes stream instead of
  fetching a stream through the request context. `grok-final.log` passes 4/4.

## Requested full run

The client stage has one failure (**ours, inherited round 0 defect**):

- `packages/snapback4/test/server-clock-wire.test.mjs:84` —
  `web: a legacy admission keeps its floor through upgrade, retirement and rollback`.
  Expected persisted floor `1004000`, actual `null`; assertion:
  `attach commits the backfill before retirement`.
  `AdmissionJournal` forwarded `queued` through `IdentityAdmissions` without
  `restore_clock_floor`. The unchanged test also failed in isolation
  (`clock-wire-isolated.log`: 9 pass, 1 fail), ruling out load as an excuse.
  Fixed on web and native by forwarding the queue request. Corrected checks:
  `clock-corrected.log` 42/42; `native-clock-final.log` 1/1; final matrix 319/319.

Full client counts: 4604 tests, 4593 pass, 1 fail, 0 cancelled, 10 skipped.
All Rust targets/doctests and the whole guide passed. The full run was not
restarted after fixing the clock issue; its red snapshot remains the result.
No failure is classified as baseline or environmental. All **91/91** model
tests pass, including the requested 10,000 extended session sequences. No other
full-run failure occurred.

Exact script summary (exit 1):

```text
== 1 failure(s) in 1983 s
   client tests
```

Evidence formatting: `git diff --cached --check` reports trailing whitespace in
original assertion-output blank lines and the guide log's final blank line. These
raw logs are preserved. The same check restricted to source and Markdown passes.
This is log formatting, not an additional test failure.
