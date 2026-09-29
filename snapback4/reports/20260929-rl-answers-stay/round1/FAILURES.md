# Round 1 failure inventory

The full script ran once: **`== 1 failure(s) in 1231 s`**, exit 1.
The failed stage was `client tests`; its nine failures are detailed below. This file also accounts for every intermediate failing check;
intentional counterfactual failures are separate from failures of the final SDK.

## Intermediate checks — ours

All entries in this section are **ours**, including test setup and orchestration
mistakes. No entry is attributed to baseline or environment to hide a red.

- The staged whitespace check found trailing spaces in captured test output and
  extra EOF blank lines. Normalized whitespace in the report artifacts; the
  final staged check passes. Test messages and summaries are unchanged.
- The first review-test invocation used the repository-root working directory
  with a Snapback-4-relative log path; shell redirection failed before any test
  ran. The subsequent invocation used the correct directory.
- One editing command repeated that working-directory mistake (`FileNotFoundError`)
  and therefore did not install the search fixture correction before the
  second search run.
- `review-tests-first.log`: six search tests timed out waiting for the intended
  HTTP search path. The fixture omitted `retain delivered-history`, so it did
  not exercise ordinary composed search. `search-second.log` repeats those six
  failures because the preceding edit had failed.
- `search-third.log`: two offline search tests used `sync()` as a plain trigger.
  Under the corrected rule, its commit correctly bounds retention. The test now
  reacquires the same local handle to trigger a plain read; all six pass in
  `search-final.log` and the final 37-test run.
- `oracle-smoke.log` and `oracle-debug.log`: process-host smoke runs timed out
  (240 s) because the test adapter assumed process-device `call` always invoked
  a commit callback. It does not; the SDK also handles completion after the
  returned promise. The adapter now records the fixture commit exactly once on
  either boundary, before SDK notifications. Its wait is also bounded. These
  initial smoke runners were interrupted through their recorded tool sessions
  after their timeout; the corrected process/wasm smoke and final runs finish.
- `oracle-final-public-signout.log`: process passed 300 seeds, then wasm hit
  `ENOENT` when the full suite's wasm regeneration briefly removed the artifact.
  This was our overlapping verification, not an external environment failure.
  The final `oracle-qualified.log` rerun after regeneration passes 300 per host.
- `affected-first.log`: 17 stale test assertions, all corrected. Six held
  local-commit assertions required no bound; three failure/expiry assertions
  retained after change evidence. Eight presence-ordering assertions treated
  freshness copies as completed recovery. They now identify replacement by
  answer identity and await it, preserving all memory-order expectations.
  `affected-corrections.log` passes all 96 tests in those files.

The failing test cases follow (one entry per test, duplicates from the
reporter's detailed failure section removed). Membership-removal cases use
neutral wording here; the linked log records preserve the original titles.

### review-tests-first.log — ours

- `process: ordinary search offline classification`
- `process: ordinary search loading classification`
- `process: ordinary search denied classification`
- `wasm: ordinary search offline classification`
- `wasm: ordinary search loading classification`
- `wasm: ordinary search denied classification`

### search-second.log — ours

- `process: ordinary search offline classification`
- `process: ordinary search loading classification`
- `process: ordinary search denied classification`
- `wasm: ordinary search offline classification`
- `wasm: ordinary search loading classification`
- `wasm: ordinary search denied classification`

### search-third.log — ours

- `process: ordinary search offline classification`
- `wasm: ordinary search offline classification`

### affected-first.log — ours

- `wasm: apply membership removal, keep=undefined, held`
- `wasm: admit membership removal, keep=undefined, held`
- `wasm: transfer membership removal, keep=undefined, held`
- `process: apply membership removal, keep=undefined, held`
- `process: admit membership removal, keep=undefined, held`
- `process: transfer membership removal, keep=undefined, held`
- `wasm keep: a failure re-read preserves the displayed deadline`
- `process keep: a failure re-read preserves the displayed deadline`
- `online keep: a failure re-read preserves the displayed deadline`
- `wasm: an accepted background reply does not replace a newer answer another read remembered`
- `wasm: a refusal read at a later store cut outranks an answer remembered before it landed`
- `wasm: a read retried after its store changed takes a new place in the order`
- `wasm: an accepted background reply does not undo a newer read's deletion of an absent answer`
- `process: an accepted background reply does not replace a newer answer another read remembered`
- `process: a refusal read at a later store cut outranks an answer remembered before it landed`
- `process: a read retried after its store changed takes a new place in the order`
- `process: an accepted background reply does not undo a newer read's deletion of an absent answer`

### oracle-smoke.log — ours

- `mixed evidence schedule process: 300 independent histories`
- `packages/snapback4/test/mixed-evidence-oracle.test.mjs`

### oracle-debug.log — ours

- `mixed evidence schedule process: 300 independent histories`
- `packages/snapback4/test/mixed-evidence-oracle.test.mjs`

### oracle-final-public-signout.log — ours

- `mixed evidence schedule wasm: 300 independent histories`

## Intentional counterfactual failures

These verify that the regressions fail without the fixes; they are not failures
of the final SDK.

- `review-tests-round0.log`: **31/35 fail** against the exact saved round 0 SDK.
  Twenty-nine expose our round 0 omissions. The two remembered-answer recovery
  cases expose the **pre-existing baseline** limitation called out by Astra.
  Four explicit search loading/denial cases pass and pin existing behavior.
- `mutant-change-fence.log`: **2/2 fail**, process and wasm, after removing only
  the pre-change completion fence. This is an intentionally injected version
  of Grok's extra ordering finding.
- `mutant-offline.log`: **3/3 seeds fail on each host** after deleting only the
  offline freshness assignment from `ReadObservation.failed()`. Both host tests
  fail with `offline answer still fresh` and the exact freshness assertion.

### Round 0 counterfactual test titles

- **ours (round 0):** `apply keeps its bound on held, keep=undefined`
- **ours (round 0):** `apply keeps its bound on throw, keep=undefined`
- **ours (round 0):** `admit keeps its bound on held, keep=undefined`
- **ours (round 0):** `admit keeps its bound on throw, keep=undefined`
- **ours (round 0):** `settle keeps its bound on held, keep=undefined`
- **ours (round 0):** `settle keeps its bound on throw, keep=undefined`
- **ours (round 0):** `apply keeps its bound on held, keep=true`
- **ours (round 0):** `apply keeps its bound on throw, keep=true`
- **ours (round 0):** `admit keeps its bound on held, keep=true`
- **ours (round 0):** `admit keeps its bound on throw, keep=true`
- **ours (round 0):** `settle keeps its bound on held, keep=true`
- **ours (round 0):** `settle keeps its bound on throw, keep=true`
- **ours (round 0):** `process: applied membership removal and held replica replacement`
- **ours (round 0):** `process: applied membership removal and throw replica replacement`
- **ours (round 0):** `wasm: applied membership removal and held replica replacement`
- **ours (round 0):** `wasm: applied membership removal and throw replica replacement`
- **ours (round 0):** `online receipt bounds held replacement, keep=undefined`
- **ours (round 0):** `online receipt bounds offline replacement, keep=undefined`
- **ours (round 0):** `online receipt bounds held replacement, keep=true`
- **ours (round 0):** `online receipt bounds offline replacement, keep=true`
- **ours (round 0):** `online: ephemeral-only /changes bounds a held replacement`
- **ours (round 0):** `process: ephemeral-only /changes bounds a held replacement`
- **ours (round 0):** `wasm: ephemeral-only /changes bounds a held replacement`
- **ours (round 0):** `ephemeral periodic sampling is distinct from change evidence`
- **ours (round 0):** `held approved A gets offline metadata from B with A identity, confirmation and deadlines`
- **ours (round 0):** `process: plain offline server watch with failed recovery keeps honest metadata`
- **ours (round 0):** `wasm: plain offline server watch with failed recovery keeps honest metadata`
- **baseline:** `process: change evidence retires remembered membership answer before failed sync`
- **baseline:** `wasm: change evidence retires remembered membership answer before failed sync`
- **ours (round 0):** `process: ordinary search offline classification`
- **ours (round 0):** `wasm: ordinary search offline classification`

## Full script, once

The client stage reports **4,644 tests: 4,625 pass, 9 fail, 10 skipped**.
All nine are **ours**; none is attributed to baseline or environment.
Exact summary: **`== 1 failure(s) in 1231 s`**, exit 1. The separate
model stage passes **79/79**; all other script stages pass.

- **Ours:** `expiry retry server pagination watch wasm`.
- **Ours:** `expiry retry server pagination watch process`.
  Both counted an additional legitimate refresh after change evidence. The
  expiry-only fixture could return a streaming poll's headers before freezing
  sync, then receive its change body after the freeze. The new in-flight fence
  correctly retries that read. The fixture now parks `/changes` from its first
  request, preserving the exact two-page/cursor assertions. A saved-round-0
  comparison passes both old assertions; the trace records the new fence and
  retry. The final 14-test file passes in the scoped rerun.
- **Ours:** `createApp keep=true property: wasm, seed 23, 50ms authority`.
- **Ours:** `createApp keep=true property: wasm, seed 44, 50ms authority`.
- **Ours:** `createApp keep=true property: wasm, seed 445, 50ms authority`.
- **Ours:** `createApp keep=true property: process, seed 23, 50ms authority`.
- **Ours:** `createApp keep=true property: process, seed 44, 50ms authority`.
- **Ours:** `createApp keep=true property: process, seed 445, 50ms authority`.
  The legacy property's recorder reset its deadline to undefined at a lingering
  remount even though the watch retained the original absolute deadline. It
  then rejected an on-time deadline withdrawal. It now starts from the actual
  remounted answer's deadline, preserving the existing withdrawal invariant.
  The whole 18-case property file and 14 expiry cases pass **32/32** in
  `full-assertion-fixes.log`.
- **Ours, inherited from round 0:** `profile route is chosen once per account and survives later loading`.
  Round 0 deleted the obsolete `initialProfileRoute` workaround from the manual
  but left its execution test. Removed that test with the removed example; the
  real mounted React gate proof remains. The surviving README tests pass.

Diagnostic reruns retained in this directory:

- `expiry-diagnosis.log`: repeats the two expiry assertion failures above.
- `expiry-round0.log`: our temporary baseline probe initially used the wrong
  relocated fixture root and failed loading the wasm file before tests. Fixed
  in `expiry-round0-corrected.log`, which passes both baseline cases.
- `expiry-trace.log`: repeats the wasm expiry assertion with the new
  observation-version fence and retry explicitly traced in an ignored SDK copy.
- `keep-app-diagnosis.log`: repeats the wasm/23 remount recorder failure above.
- `full-assertion-fixes.log`: corrected expiry and property files.
- `readme-final.log`: remaining README execution tests, **6/6**.

All nine full-script failures are fixed in these scoped reruns. The full
script was not rerun; its original red result is preserved.
