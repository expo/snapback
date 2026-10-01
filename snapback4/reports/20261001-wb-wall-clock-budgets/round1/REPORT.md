# WB round 1 — preserve interval and blocked-response proofs

Fixed both Astra P2 findings against round 0 (`33b412a54b`). Each required
scratch mutation **passes round 0 and fails round 1**. The re-audit also found
and repaired the same interval loss in `presence-live`, on all three client
tiers, and tightened completion accounting for rejected idle-poll bodies.
Only three existing test files change; production files and artifacts do not.

The first presence refresh now uses controlled Date/timers: no query before
300 ms, a query within **[300, 301] ms after the answer**, then the published
answer without loading. A separate captured-real-timer hang guard bounds fixture
completion. The live integration test verifies the server's 5000 ms interval,
advances only the presence scheduler, and observes the real online mark and
composed answer. HTTP, native/wasm execution and change-feed watchdogs retain
real scheduling. Module-load instrumentation changes only the scheduler's timer
bindings; it asserts that the module was actually intercepted.

The slow-reader test resets the server's latency window before its sole `/sync`
request. After the probe's server completion is recorded, `/sync.n` must still
be zero. Releasing the socket must then produce exactly one completed `/sync`.
The client socket flags no longer carry the claim that the server is blocked.

[AUDIT.md](AUDIT.md) records the re-audit of all 205 round-0 edited
files, distinguishing them from its 235-file affected execution closure. It
identifies surviving bounds, actual barriers, additional fixes and limits.
The [original prompt](round0-prompt.md), [full Astra review](astra-round0.md),
and [round-0 report](../REPORT.md) retain the commission and prior evidence.

## Final verification

All three changed files run in each row. These are **five complete passing
invocations of the same final source**, not composite coverage. Each loaded run
uses eb1000's ten CPUs **86–95**, 48 SL arithmetic busy workers on that same
mask, and the inherited seccomp affinity guard. All 48 workers survive and
accumulate CPU time. The publication file-pool policy supplies three loaded
slots; the unconfined invocation uses 24. No seeds, samples or counts are reduced.

| Run | Passed / failed / cancelled / skipped | Elapsed seconds | Evidence |
|---|---:|---:|---|
| Loaded 1 | 23 / 0 / 0 / 0 | 28.390 | [log](loaded-1.log), [custody](loaded-1.json) |
| Loaded 2 | 23 / 0 / 0 / 0 | 27.215 | [log](loaded-2.log), [custody](loaded-2.json) |
| Loaded 3 | 23 / 0 / 0 / 0 | 27.729 | [log](loaded-3.log), [custody](loaded-3.json) |
| Loaded 4 | 23 / 0 / 0 / 0 | 27.396 | [log](loaded-4.log), [custody](loaded-4.json) |
| Loaded 5 | 23 / 0 / 0 / 0 | 27.408 | [log](loaded-5.log), [custody](loaded-5.json) |
| Unconfined | 23 / 0 / 0 / 0 | 13.359 | [log](unconfined.log), [custody](unconfined.json) |
| Whole guide | 110 / 0 / 0 / 0 | 4.40 test execution | [log](guide.log) |

The exact guide summary is:

```text
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.40s
```

Every Node invocation reports `tests 23`, `pass 23`, `fail 0`, `cancelled 0`,
`skipped 0`. [qualification.json](qualification.json) binds these results to
logs/metadata. [source-manifest.json](source-manifest.json) covers 235 inputs:
the three tests, wait helper, server executable, client dist and wasm artifacts.
Every input hash and tested source diff stayed unchanged during all six runs.
[environment.json](environment.json) records Node 24.13.1 and host identity.
Reference and whitespace validation pass. No new test file or product publication
leaf was added, so no unrelated root inventory regeneration was performed.

**No full suite was run**, as requested for this test-only round. The round-0
1404-second whole-suite pass remains historical evidence, not a round-1 claim.
No wasm rebuild, publication, push, or Mac execution occurred.

## Scratch mutation controls

[controls.py](controls.py) creates disposable trees with copied client dist and
the appropriate full test files. The original checkout's product is never
modified. The scratch product is restored after each run. Exact patches,
commands, original/mutated input hashes and log hashes are retained in
[controls.json](controls.json) and the per-control files.

| Control | Round 0 | Round 1 | Observed distinction |
|---|---|---|---|
| Add 4000 ms to the first product presence refresh timer | [10/10 pass](refresh-round0.log) | [9 pass, first test fails](refresh-round1.log) | New `[300, 301]` assertion sees only one query at 301 ms. All ten tests execute in each version. |
| Delay the slow-reader probe 6500 ms | [10/10 pass](slow-reader-round0.log) | [slow-reader assertion fails](slow-reader-round1.log) | Server records `/sync.n = 1`, `refused = 1`, at 5463.428 ms on round 0 and 5439.252 ms on round 1. The new check requires zero completions. Node counts the failed child and its parent as two failures (eight other children pass). |
| Re-audit control: add 4000 ms to every presence refresh timer | [all three live tiers pass](live-interval-round0.log) | [all three live tiers fail](live-interval-round1.log) | The real server still supplies 5000 ms; the new controlled interval checks reject 9000 ms. Round 0 takes about 9 s to turn each mark and still passes. |

These expected failures are successful mutation controls. The slow-reader
round-0 control adds a latency-window reset and diagnostic read solely to
measure completion; its pass/fail assertions remain those of round 0. Its
round-1 counterpart uses the same delay and diagnostic. The mutation is the
same 6.5-second probe delay from Astra's review.

## Failures and corrections

Final qualifying runs: **ours 0, baseline 0, environmental 0**.

- The first `presence-live` fixture draft statically imported `web.js`, whose
  transitive imports loaded the presence module before the timer hook. Its
  three tiers therefore reached the independent 122-second `TEST_HANG` while
  waiting for controlled timers ([complete failed log](presence-live-initial.log)).
  This was **ours**, a fixture setup error. Moving that import behind the hook
  fixes it; the final fixture also requires exactly one intercepted module.
  [The corrected diagnostic run](presence-live-corrected.log) passed 3/3,
  followed by all six final qualifying runs. The failed run is not credited.
- [The initial two-file diagnostic](initial-scoped.log) passed 20/20 before
  adding the re-audit repairs. It is not substituted for final-file coverage.
- Two shell redirections initially used the repository root versus `snapback4`
  incorrectly, before Node launched. The nested empty report directory was
  removed and the commands rerun from the correct working directory. These
  were **ours**, command setup errors, not failed product tests.
- The initial whitespace check flagged two Markdown hard-break spaces in the
  copied Astra review. Trimmed those spaces in the report copy; the original
  review remains untouched. This was **ours**, imported evidence formatting.
- The three intentional mutation failures are described above; no other failed
  tests, cancellations or asynchronous errors occurred in the final scope.

## Reproduction

Use the existing round-0 built binary, client dist and wasm matching the input
manifest, with the pinned Node runtime. From `snapback4/`:

```sh
for n in 1 2 3 4 5; do
  python3 reports/20261001-wb-wall-clock-budgets/round1/run.py loaded-$n 48 -- node --test --test-concurrency=3 packages/snapback4/test/presence-refresh.test.mjs packages/snapback4/test/http-bounds.test.mjs packages/snapback4/test/presence-live.test.mjs
done
python3 reports/20261001-wb-wall-clock-budgets/round1/run.py unconfined 0 unconfined -- node --test --test-concurrency=24 packages/snapback4/test/presence-refresh.test.mjs packages/snapback4/test/http-bounds.test.mjs packages/snapback4/test/presence-live.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
python3 reports/20261001-wb-wall-clock-budgets/round1/controls.py
```

[run.py](run.py) is the round-0 evidence harness with its default root adjusted
for the nested report directory. It uses the already built round-0
`target/wb-load/busy` and `confine` binaries; their hashes are recorded per run.
The source recipe is unchanged: [busy.c](../busy.c), [confine.c](../confine.c).
From the repository root, `./ref-check --verbose` validates the references.
The runs reuse this lane and its build cache; they execute sequentially, so
there are no simultaneous fixture writes to this checkout. Unrelated shared
host work and unconfined diagnostic/control processes are not excluded.

One dated append-only journal entry accompanies the commit, with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
