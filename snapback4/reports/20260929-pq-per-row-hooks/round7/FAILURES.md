# Round 7 failure ledger

All failures below are **ours**, arising while integrating the lanes or adapting
fixtures to queue scheduling. None is exempted as baseline or environmental.
Passing corrections do not change a recorded red run into a green one.

## Initial combined affected run

`affected-initial.log`: **434 tests, 417 passed, 17 failed**, no skips or
cancellations. Every failing case:

| File / test | Cases | Cause and correction |
| --- | --- | --- |
| `answers-stay-review`: `apply keeps its bound on held`, `apply ... throw`, `admit ... held`, `admit ... throw`, `settle ... held`, `settle ... throw` | Each with `keep=undefined` and `keep=true`: 12 | Unit fixture checked immediately after commit, before queued execution. Assert no deadline there, start the attempt, then check failure/deadline withdrawal. |
| `keep-app-model`: `createApp keep=true property: wasm, seed 23, 50ms authority`; same with seed 445 | 2 | Remount cleared the fixture's saved answer reference; a later valid deadline withdrawal had no recorded deadline. Seed the reference from the remounted snapshot. |
| `per-row-retention`: `wasm: an unrelated replicated write preserves online-only memory offline`; process equivalent | 2 | Fixture required `!revalidating` after offline memory recovery. RL preserves `revalidating`; still require the data, offline freshness and zero unrelated evaluations. |
| `per-row-retention`: `queued keep=true: episode starts at attempt; retries never renew it` | 1 | Old assertion expected no bound for `keep:true`. Change evidence now bounds both retaining policies. |

`focused.log`: **226 tests, 224 passed, two failed**. These are the same wasm
and process offline-memory expectation above. All other per-row tests, RL review
regressions, real-clock React hosts and raw deadlines passed.

`app-model-diagnosis.log`: one selected test, one failure, the same wasm/seed-23
remount recording issue. This repeated the failure before its correction.

`retention-unit-before.log`: six selected tests failed: local `apply`, `admit`
and `settle`, each with `keep=undefined` and `keep=true`, in
`retention-episode.test.mjs`. These additional RL unit cases also expected a
deadline at enqueue time. They now assert the queued state, start the attempt,
and retain their deadline/replacement assertions. Full file correction:
`retention-unit-final.log`, **65/65**. This correction happened during the full
suite's client phase; that process had already loaded the old assertions.

## Seeded schedule setup and correction

- `oracle.log`: process and wasm 300-seed test groups both report an unhandled
  `injected replacement failure`. PQ's scheduling allowed a direct query's
  post-commit retry to enter a fault intended for the observed replacement.
  The seed loop continued after Node marked each group failed; the test child
  and its two fixture descendants were explicitly stopped, with PIDs in
  `stopped-oracle.json`. Summary: three tests, one pass, two fail. This did not
  complete the requested 300-seed qualification.
- `oracle-diagnosis.log` and `oracle-corrected-smoke.log`: three-seed probes
  each report the same two failed host groups. Per-seed JSON additionally
  records authority/metadata consequences after the fixture failure interrupted
  the schedule; none is omitted. The latter still used the old fixture because
  the preceding edit command used the wrong working-directory prefix.
- `oracle-smoke.log`: the original one-seed probe passes both hosts; this seed
  alone did not expose the direct-query/fault overlap.
- `oracle-fixed-smoke.log`: three seeds per host pass after identifying direct
  query work independently. The schedule still waited for an incidental future
  read after ending a failure. Timing probes (`oracle-timing*.log`) pass but
  show about four seconds waiting for that read plus serialized sign-out cleanup.
- `oracle-queue-smoke.log`: three seeds per host pass; an empty `sync()` did
  not request a failed local watch's replacement, so that attempted fixture
  repair retained the same delay.
- `oracle-final.log`: superseded 300-seed run stopped while qualifying that
  slow schedule. Node reports one test-file failure due to the interruption
  (one reference pass). `stopped-slow-oracle.json` records its child and two
  fixture descendants. It is not claimed as qualification.
- `oracle-refetch-smoke.log`: three seeds per host pass after explicit public
  resubscription and bounded, awaited sign-out cleanup. No assertion, model
  count or timeout was relaxed. Final qualification uses this schedule and
  retains delayed cleanup failures until each host finishes.

- `oracle-qualified.log`: the process host reached the unchanged 240-second
  limit after seeds 1–284 had passed. Node reports one cancelled host group
  (`test timed out after 240000ms`), two passes and zero ordinary test failures.
  The timed-out function finished its loop; process seeds 285–300 then recorded
  three consequences each after Node restored its mocked clock: visibility at
  the fixture bound, the held-removal deadline assertion, and offline ephemeral
  metadata assertions. The complete per-seed messages are retained in
  `oracle-qualified-process.json`. The wasm host completed all 300 seeds with
  zero failed seeds. Attribution: **ours**, duplicate sign-out/close promises
  consumed the cleanup batches. Keep each main client's shutdown once, retain
  all pending cleanup failures by reference, and qualify again. No timeout or
  resource limit was raised.

## Command/setup mistakes

- An initial LLP lookup used the wrong filename; read the actual
  `3000.023-answers-stay-on-screen.rfc.md` afterward.
- `python` is unavailable on this host; reran the resolution script with the
  installed `python3`. No files had been edited by the failed invocation.
- Lookups for a nonexistent delivery-boundary test and `per-row-presence`
  filename were corrected to `delivery-fault-matrix` and `per-row-boundaries`.
- One fixture edit used a repository-root prefix while already in `snapback4/`;
  it failed before editing, and the following diagnostic run remained red as
  recorded above. The next edit used the correct directory.

- The first staged whitespace check found one final blank line in `guide.log`.
  Trimmed that log terminator; the final staged check passes.

## Required full suite

The client phase loaded the old six assertions from `retention-episode` before
their correction. Its 4,956 tests contain 4,940 passes, six failures, ten existing
conditional skips and zero cancellations. Every failing test, all **ours**:

- `local apply retains within a change episode, keep=undefined`
- `local admit retains within a change episode, keep=undefined`
- `local settle retains within a change episode, keep=undefined`
- `local apply retains within a change episode, keep=true`
- `local admit retains within a change episode, keep=true`
- `local settle retains within a change episode, keep=true`

Each expected deadline 2000 immediately after enqueueing and received undefined.
The corrected test first checks that deferred state, starts the attempt, then
checks the same deadline. `retention-after-full.log` reruns the entire file after
the full phase finished: **65/65**, zero skips or cancellations. Baseline: 0;
environmental: 0. Runtime source is unchanged. The full run remains red and will
not be repeated. All other stages pass, including the final **79/79** client
models. Exact summary and exit status:

```text
== 1 failure(s) in 1241 s
   client tests
```

Exit **1**. This was the only invocation of `scripts/test.sh`. The elapsed time
also exceeds the inherited 60-second suite target; no ceiling was increased.
