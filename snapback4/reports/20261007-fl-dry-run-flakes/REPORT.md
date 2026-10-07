# Lane FL — load-safe publication dry-run tests

**Round-3 PID-barrier correction:** [round 3](round-3/REPORT.md) closes Astra's
P2, corrects the round-2 audit, and verifies the complete publisher record and
fault-request protocol. Rounds 0–2's read and custody assertions remain intact.

**Round-2 Mac follow-up:** [round 2](round-2/REPORT.md) fixes simulator-cleanup
observation, audits all 94 background cases, and records Linux recovery controls.
The round-1 strict read comparison and round-0 custody cases remain intact;
the user's Darwin soak is still required.

**Round-1 correction:** Astra found that the initial read retry could discard
non-sequence corruption together with a sequence change. The read comparison
and its negative controls below are historical; [round 1](round-1/REPORT.md)
records the corrected guard and combined-fault regressions. Custody is unchanged.

2026-10-07. Based on `b14888f763`, branch `sb4-intent/fl-dry-run-flakes`.
Work and verification stayed in this worktree on the assigned eb1000 host
(`hostname` reports `expose-builder-pixel`). No other machines, worktrees or
unowned processes were used. No push or publication.

## Read-evidence flake

The background writer is the expiry sweep: the fixture seeds
`expired { id: 'expired', until: 1 }`. `serve_maintenance::timely` calls
`Engine::sweep_expired_for`, which physically removes it and records an
`expire` / `sweep` commit. The identity mutation and seed leave sequence 2;
the deletion advances it to 3 without changing either point query's answer.
The old test saved the absent answer before several other queries and compared
it with a later hidden answer, without establishing its claimed common watermark.

The test now obtains adjacent absent/hidden pairs, retrying only unequal
numeric sequences, at most eight times. At the same sequence it still compares
the complete serialized answers, including the sequence and every meter field.
Exhausting the pair bound fails. Each traced absent request's new `requestId`
must be persisted before taking the evidence baseline; hidden reads, nested
nulls and filtered-then-missing reads must still leave that baseline unchanged.
No response fields are removed or normalized.

The governing context is LLP 3000.015 §2.1 and LLP 3000.031 §1.2, plus the
installed EMPTY_READ guide: true probe misses may be local opt-in evidence;
visibility-filtered answers must not disclose their cause. No product or
public authoring behavior changes.

## Retention custody flake

LLP 3000.030 §15 already permits 30 seconds of work followed by the WD drain
(5 seconds without observed exits, 60 seconds maximum). The old assertions
required cancellation in 10 seconds (40 for a deadline), while the entire
setup, two publications, drain and cleanup shared a 90-second guard.

The test now waits for the **compressor, its TERM-resistant child, native
keeper and guardian to exit**, then for the background worker to release its
lease and a new generation to complete its proof. It still checks group
membership, immediate lock-busy refusal, current CLI status and the native
result. The deadline case requires both the actual product diagnostic and
at least 25 seconds since the retention work directory's timestamp. Setup and
inspection time count toward that lower bound. Each state observation has a
105-second bound (30 + 60 + 15 seconds of scheduling slack), under one
300-second test guard. Neither a result file nor elapsed time alone proves
drain. The file runner's 900-second minimum stall watchdog remains sufficient;
no watchdog census entry or product budget changes.

Abort-aware waits stop the async body when Node cancels it. `t.after` releases
the fixture lease and awaits cleanup even on timeout. Only after success or
failure, an independent fixture marker makes each still-live mock compressor
member kill **its own** process group. This avoids signaling a reusable group
number and does not help the product pass its unaided drain assertions. Cleanup
also checks remaining retention keeper/guardian records before deleting them.
Linux liveness checks treat zombies as exited, matching product custody.

The four pre-driver cases now also run on Linux: a private Node preload selects
the wrapper's background branch, while the actual Linux binary and native
process supervision remain unchanged. Linux must launch the real driver and
report its platform failure; Darwin must still reach the mocked simulator tool
and report the original skipped outcome. The three post-driver cases retain
their existing Darwin condition.

## Verification

All required affected suites and final loaded repetitions passed. Native drain
measurements under the two-CPU load were:

| Path | Runs | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| SIGTERM | 20 | 154 ms | 206.5 ms | 258 ms |
| SIGKILL | 20 | 153 ms | 201 ms | 250 ms |
| supersede | 20 | 517 ms | 684 ms | 892 ms |


- Developer evidence suite: 21 passed; Rust witness module: 72 passed.
- Export suites: background, publication, native, native-round2 and failure,
  through `scripts/run-client-tests.mjs`. Final results: **80 passed, 33 existing platform skips, zero failures or leaks**
  across all five files (background alone: 62 passed, 32 Darwin skips).
- Synthetic load: four owned Python busy loops and both selected tests pinned
  to CPUs 80–81 using `taskset`. Final repetitions: **20/20 empty-read tests and 20/20 each of pre-driver
  SIGKILL, SIGTERM and supersede custody**; zero failures. All four load
  processes were reaped. Earlier successful iterations preceded final cleanup
  and status-assertion refinements; these counts refer to the final source.
- Full reference check: one inherited error,
  `snapback4/crates/snapback4-difftest/src/lib.rs:3` referring to LLP 3000.035's
  `#5.1-stage-1-a-generator-and-rust-against-rust-comparison`. Both source and
  target match the starting commit. Affected LLP references and constraints
  were reviewed; no governing document needs a semantic update.
- Fresh-tree prerequisite: `bun install --frozen-lockfile` succeeded. The
  attempted full client build reported missing generated wasm imports; it
  emitted the CLI shim dependency used by these Node suites. No wasm build,
  full publication qualification or Darwin execution is claimed.

The native supervisor's cancellation and owner-death paths converge on the
same group-wide SIGKILL drain loop. Darwin uses `EVFILT_PROC/NOTE_EXIT`, Linux
`PR_SET_PDEATHSIG`; there is no SIGKILL-specific grace period or polling delay.
The measured Linux paths show no SIGKILL slowness requiring a product change.
Darwin background QoS/scheduling is not measured by this Linux run.

## Negative controls and timeout cleanup

[Response controls](evidence/empty-negative-summary.json) corrupt every one of
11 non-sequence top-level fields, all eight meter fields, and one extra field.
All 20 fail at the full-answer comparison. Endless sequence drift fails at
eight pairs; one unequal sequence followed by equal answers passes. The
instrumentation was temporary and the source was restored and rebuilt.

[Custody control](evidence/custody-negative.log) uses a privately built binary
with both native group-kill sites disabled after the contender check. The
unchanged test fails its 105-second drain observation while compression remains
alive. The fixture teardown releases the mutation and kills the owned group;
the file runner reports no leak. The private binary/source mutation is not
shipped. Two preliminary controls are retained for honesty: SIGSTOP was
ineffective because Linux orphan-group handling resumed the guardian, and
enabling the kill mutation before the contender caused an earlier, valid
cleanup failure instead of the intended owner-death failure. Neither is counted
as the final control.

[Timeout control](evidence/timeout-control.log) stalls the case after the
compressor and child start and gives that private test copy a 10-second outer
guard. Node reports `testTimeoutFailure`; teardown verifies both processes exit,
checks native custody, removes the fixture, and the normal runner reports no
`TEST_FILE_LEAK` or inspection failure. These expected negative exits are not
suite failures.

## Reproduce

From `snapback4/`, with the debug CLI and emitted CLI shim dependency available:

```sh
mkdir -p target/fl-verification
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=6 cargo test -p snapback4 --test dev_refusals --no-run
python3 reports/20261007-fl-dry-run-flakes/reproduce/load.py
python3 reports/20261007-fl-dry-run-flakes/reproduce/empty-negative.py
python3 reports/20261007-fl-dry-run-flakes/reproduce/build-negative.py
node reports/20261007-fl-dry-run-flakes/reproduce/custody-negative.mjs
node reports/20261007-fl-dry-run-flakes/reproduce/timeout-control.mjs
```

Run the mutation scripts sequentially without concurrent builds. Each restores
its source in `finally`; the custody binary is isolated in `target/fl-negative`.
Load processes are tracked as direct children and always terminated/reaped by
the load script. [Environment and source hashes](evidence/environment.json),
[loaded output](evidence/loaded-runs.log), [Rust suites](evidence/dev-refusals-suite.log),
[witness suite](evidence/witness-rust-suite.log), and
[final export suites](evidence/export-suites-final.log) retain the evidence.
