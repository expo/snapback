# Failure accounting

## Measurement verdicts

These are current-baseline observations; BP changes no runtime behavior.

- Warm search midpoint: 5.632 ms against 5.149 ms, margin **−0.482 ms**.
  Only 2/9 individual batches pass. The existing search-midcurve follow-up
  remains relevant; this lane does not declare it fixed.
- Warm trending midpoint: 3.039 ms against 2.527 ms, margin **−0.511 ms**.
  Only 4/9 individual batches pass.
- Warm Insights full/small passes in the median but fails in 2/9 individual
  batches; its midpoint passes in the median but fails in 3/9. These are not
  discarded as environmental outliers. All raw margins remain in summary.json.
- The Mac's broad several-fold growth does not reproduce. That is the user's
  stopping condition, not a successful optimization or an all-rules pass.

No replay action failed. Both checkpoint verifications and final verification
passed; no partial/failed replay was restarted or substituted for this run.

## Setup corrections and instrumentation limits

- The project-local llp-orient symlink points into an uninitialized vendor
  submodule. Read the existing landing checkout's skill instead. No dependency
  bootstrap or other lane's files were changed.
- SQ's copied production binary belongs to its pre-LV-revert source, not the
  commissioned base. It was used only for initial guide inspection, never for
  a BP timed run, and renamed `snapback4-sq-reference`. The measured diagnostic
  and final production binary were both built in this checkout from 4fd338de5.
  Current guide source was read separately. No mixed-binary comparison is claimed.
- The initial thread observer omitted aggregate process CPU (needed to count
  exited request threads). SQ's aggregate process observer was started during
  replay; its cumulative counters still include process-start CPU. Complete
  per-request lifetime CPU was logged from the beginning. The final monitor
  source includes process counters for future runs. No early per-second
  aggregate samples are reconstructed or invented.
- Linux schedstat delay accounting was disabled. Zero wait counters are not
  classified as zero wait; the report uses sampled runnable population and
  explicit HTTP queue/acquisition/engine/CPU timings and states their limits.
- Instrumented measurements include logging/counter overhead and read-only
  observer work. No uninstrumented before/after speedup is claimed.
- macOS execution remains for the supervisor. The shell syntax and its Linux
  component pipeline are validated; no two-binary Mac execution is claimed.

## Tests

Affected tests: 8 FIFO/admission, 5 maintenance chunks, 1 delivery and 2 scale
complexity tests passed. Whole guide: 98 passed. The existing explicitly
ignored sustained-request witness was run on CPUs 0–9 and passed.

The required full suite ran once and exited 1. Exact summary:
**`== 1 failure(s) in 2129 s`**, named stage **`client tests`**.

| Classification | Failure | Evidence/disposition |
| --- | --- | --- |
| Baseline | `process: a genuinely empty partition at sequence zero is acquired durably` | After-hook `rmSync` at `acquisition.test.mjs:64` threw `ENOTEMPTY` removing `/tmp/sb4-acquisition-AsgmXW` while the dev/native children remained alive. Runtime and test files are byte-identical to base `4fd338de5`. |
| Ours | No introduced product/test failure | Measurement hooks had been removed before all validation. |
| Environmental | No independently established failure | Host concurrency is recorded, but is not used to relabel the cleanup race. |

The failing acquisition shard (`2/4`) remained idle for over ten minutes after
reporting its failure; other client processes had finished. The fixture registers
directory deletion before closing/reaping its clients and server. BP recorded
the owned process identities and start times, sent SIGTERM to its native child,
then to the still-stalled test worker and dev server. It did not kill by name
or signal any unrelated process. This is a **manual test-cleanup intervention**,
not an ordinary uninterrupted completion or a product fix. The runner retained
the original ENOTEMPTY failure, produced no extra reported failure for that
cleanup, and proceeded to all final models. The timestamps and owned process
tree are in `evidence/validation/hung-acquisition-processes.json.gz`.

Client totals across all shards: **4,560 passed, 1 failed, 10 skipped**.
Rust and every other stage passed; final client models: **79 passed**.
The exact failing case was rerun alone after the full suite:

```sh
cd snapback4
node --test --test-name-pattern='^process: a genuinely empty partition at sequence zero is acquired durably$' \
  packages/snapback4/test/acquisition.test.mjs
```

It passed (**1 passed / 0 failed**) in 1.267 seconds of process wall time,
without forced cleanup. This isolated pass does not replace the original
failure. The [follow-up ticket](../../../issues/20260929-snapback4-acquisition-cleanup-enotempty.md)
records the inherited race and suite hang; it is outside BP's stop condition.

The documented 60-second suite target is also missed. SQ's baseline already
took 1,690 seconds; BP's 2,129 seconds includes the stalled-fixture wait and
manual cleanup. No timeout, ceiling or test population was enlarged/reduced.
No second full suite was run. Full logs and the isolated result are retained.
