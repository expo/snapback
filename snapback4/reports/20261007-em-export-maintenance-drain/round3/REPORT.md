# EM round 3 — maintenance wakeup handoff, 2026-10-07

Both commissioned wakeup defects now have deterministic reproductions and product
fixes. With the fixes removed in a scratch build, each forced window strands a
pending request and fails the unchanged **90-second** drain check. With the fixes,
the observer drains both. All six new regressions passed **30 repetitions under
CPU/disk load**, including cancellation and preserved stop conditions.

A separate loaded repetition of the historical publication-handoff case also
failed. Its retained evidence identifies **parked native cleanup after
`E_WITNESS_PROCESS: invalid /proc process group`**. That is an existing open
Linux inspection issue, and is not a zero-failure qualification. The missing
historical snapshots still prevent attribution of the earlier incidents to any
of these paths. Both commissioned tickets remain open for the operator's macOS
soak. No process-ownership check, queue drain predicate or timeout was weakened.

All work stayed in lane-em on eb1000, starting at `aca7883e26eb3372253eec0db1f7d8f88593ba07`.
No other worktree or host was used; only owned test/load children were controlled.
Nothing was pushed or published. Round 2's bounded/private diagnostics,
asynchronous trace writer and omission of Darwin descriptor capture remain.

## Governing context and product change

The governing constraints are [LLP 3000 §7](../../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
and [LLP 3000.030 §15](../../../../llp/3000.030-native-proof-in-minutes.rfc.md#15-export-proves-native-execution-nx-rounds-08-2026-10-02):
publication does not wait for retention; one pending observer and one active
scan share durable request/claim state; automatic successors inherit the
observation expiry; cancellation, sleep and expiry stop an attempt. Native work
and WD cleanup keep their separate existing bounds. Diagnostics grant no custody.
The design and updated contract remain in §15; no new LLP is needed.

- **Empty second check:** `kick_until` formerly returned under
  `maintenance-next.lock` after finding the earlier work already covered. A
  producer could commit and coalesce before that return released the lock.
  The holder now drops the lock and loops through the runnable/lease checks.
  A fresh producer's already-recorded wakeup can supply its later absolute
  expiry; there is no automatic deadline renewal.
- **Observer guard unwind:** the observer's observation body now returns to one
  release-and-handoff path. After dropping the queue lease, it checks for an
  unobserved fresh wakeup even when its guard failed. This also applies to
  launch-gate and observation I/O exits. Ordinary idle exit retains its recheck.
- **Producer/exit ordering:** a fresh producer encountering a busy lease writes
  one atomic `maintenance-wakeup.json` notification with its absolute expiry and
  sleep clock, then retries the nonblocking lease before reporting coalescing.
  A successful observer guard consumes the notification before examining work.
  If the old observer exits before notification, the producer's retry acquires
  the lease. If it exits after the producer's retry loses, its post-release
  check sees the unobserved notification. Another successful holder may consume
  the notification because it covers the request itself.

Only fresh producers write this notification. Internal peer handoffs retain the
old deadline. An expired notification or one spanning host sleep cannot restart
observation; a fresh successor uses the recorded expiry rather than a new
`now + hour` budget. With no fresh producer, cancellation/expiry leave the request
durable and start no successor. An observation that fails during active native
work still drains its owned child before handing off. Explicit launch/I/O
refusal and simultaneous peer loss retain their documented limits.

Request/claim acknowledgement, parking, retry limits, native custody and the
5-full/20-compressed selection are unchanged. `export-background.test.mjs` is
byte-identical to round 2, including lane FL's process checks and `maintenanceIdle`.
The separate regression file uses the same queue predicate and 90-second bound.
The only diagnostic collector change prioritizes the new wakeup record among
queue files; the large-inventory regression verifies it survives truncation.

## Deterministic evidence

Debug-only barriers pause after the second empty decision (`kick-empty`) and
after the top-loop guard fails (`observer-guard-failed`), while the caller still
holds the lease. `kick-locked` lets the fixture cover the original request
between the first and second runnable checks. A separate real producer commits
a request and pauses at `kick-coalesced`. A nonblocking flock probe proves the
old holder still owns the lease there. Barriers retain the existing one-shot,
20-second fallback; comma-separated points use separate markers. Release builds
compile their environment/file/pause behavior out.

The six permanent tests cover both windows, expiry and cancellation guard
handoffs, the ordering where the holder exits before notification, and expiry
and cancellation without a fresh producer. Assertions require an acknowledged
claim, exited observers, consumption of the wakeup, and inheritance of the
fresh producer's exact expiry. The deadline unit regression also refuses to
restart an expired notification. Existing sleep-clock tests continue to pass;
no real host sleep was induced on this shared machine.

`negative.py` copies the Cargo sources beneath this worktree's ignored target,
removes just the two exit fixes, and retains all barriers and producer notification
behavior. `unfixed-controls/control.json` binds that source mutation, test source
and immutable binary. The retained diff makes the negative build reviewable.
It runs the same two test bodies and requires both original drain assertion
failures, rather than treating a test watchdog cancellation as reproduction.
Both fixtures subsequently recover through the real next-export backstop.

| Retained control | Observation |
| --- | --- |
| Empty-check fix removed | `kick-empty` at 1791406447033; fresh request and `kick-coalesced` at 1791406447054. At timeout the request is pending, no observer journal exists, and no verified fixture process remains. |
| Guard handoff removed | Old expiry 1791406538585; `observer-guard-failed` at 1791406538617; fresh request/coalescing at 1791406538630. At timeout the old observer is gone and the pending request plus fresh wakeup (expiry 1791410138630) remain. |
| Fixed replay of those two bodies | Both pass in 1.05 s / 1.84 s for the complete subtests, with retained successful queue/step snapshots. |
| Existing held-lease / missing-observer controls | Both still fail the original shared-file 90-second check. Snapshots distinguish the live observer plus owned lease holder from pending work with no observer. |

The two mutant failures take 182.80 seconds together; the two existing stall
controls take 183.57 seconds. These intentional failures are not counted as
passing product tests. No sleep or timeout increase is part of the correction.

## New loaded failure: explicit native inspection refusal

The first historical-case cohort completed 16 four-case invocations. Invocation
15 failed `maintenance crash matrix: publication-handoff (off, next Expo fails)`
after 104.99 seconds; its other three cases passed. The cohort stops after that
batch by design. This is retained, not discarded or reclassified as a pass.

The failure snapshot shows `maintenance-parked.json`, no pending/claimed request,
an exited observer, and an exited scan in handoff state. Its result journal says
`E_WITNESS_PROCESS: invalid /proc process group`. The scan's native work ended
successfully after **142 ms**, then cleanup refused; `scan-complete` and the
error handoff were recorded about **350 ms** after work began. The observer
retired. The strict drain predicate then spent the remainder of 90 seconds on
the parked claim. This is a diagnosed explicit error outcome for this run,
rather than evidence of an endlessly slow scan.

The same native inspection signature is already tracked in
[the open process-group inspection ticket](../../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md).
That parser and native custody checks are unchanged in this revision. The
rejected `/proc` row itself is not in the bounded maintenance snapshot, so this
report does not infer its bytes, PID, permissions or an exit race. The existing
ticket now links this recurrence. Fixing either wakeup window cannot turn a
known parked error into successful completion, and allowing parked work in this
assertion would mask the failure. No such relaxation was made.

## Validation and retained artifacts

The complete export-background file passed **58 tests / 36 Darwin skips** in
**462.01 seconds**, overlapping the confined load. The six wakeup regressions
passed **30 × six = 180** checks on cores 80–83 with four hashing workers, one
1 MiB write/fsync/read worker, and two concurrent test invocations. The disk
exercise permits page-cache hits; it is load, not a storage benchmark.

The historical-case cohorts completed **30 repetitions of each of the four
originally affected Linux cases**, with four concurrent invocations and the same
four-core CPU/disk load: **119 passes / one failure**. Deadline, failed Expo/dead
journals and raced retention deferrals passed 30/30; publication-handoff passed
29/30 and hit the explicit inspection refusal once. The 14-invocation continuation
passed all 56 cases, without erasing the first cohort's failure. Per-case results
are retained in `evidence/results.json`; this is not a clean 30-run soak.

Five diagnostics tests, four retention tests, 14 recovery/Linux inspection tests,
the sleep-clock test, debug builds and release checks pass. Final diagnostics
and wakeup regressions were rerun after prioritizing the wakeup snapshot and
formatting the barrier block. All qualification runs use pinned copies; no
running test executable was rebuilt. The build is restored to the fixed source.
`evidence/format-only.json` proves that the two positive native source versions
differ only in indentation; both native hashes and final reruns are recorded.

`./ref-check --verbose` passed: 531 LLP documents, zero errors and zero unchecked
references. Syntax and whitespace checks also passed.

The optional repository-root inventory check reports unrelated, untouched
Snapback 1 inventory/guide issues and missing generated demo preconditions. Its
failure is retained; no root-inventory pass is claimed. Snapback 4's ordinary
client test discovery includes the new separate test file.

[Results and hashes](evidence/results.json) bind commands, outcomes, timings and
archive checksums. The [unfixed controls](evidence/unfixed-controls.tar.gz),
[fixed replay](evidence/fixed-controls.tar.gz),
[stall controls](evidence/stall-controls.tar.gz) and
[first historical cohort](evidence/affected-load.tar.gz) retain their raw evidence.
[Failure states](evidence/failure-states.json) expose the queue/process state
without extracting those archives. Raw TAP, queue/journal snapshots and trace tails are compressed without
changing bytes. Archives are verified against every original file's SHA-256
before pruning this report's completed raw captures; snapshot private modes are
preserved. Runtime retention stays at four failure/four cleanup snapshots per
explicit capture namespace. The negative and real-failure snapshots are retained
separately from successful cohorts.

The next operator step remains the macOS soak using a stable binary and
`SNAPBACK4_MAINTENANCE_EVIDENCE`. Neither the Linux-only inspection signature nor
the forced wakeup regressions establishes the cause of the earlier macOS timeout.


To repeat the six deterministic checks under Linux load, from `snapback4/`, build
once and let the driver pin the resulting binary:

```sh
cargo build -p snapback4
python3 reports/20261007-em-export-maintenance-drain/stress.py \
  --out target/em/round3-replay --rounds 30 --jobs 2 --cpus 80-83 \
  --load 4 --io-workers 1 --pattern '.*' \
  --test-file packages/snapback4/test/export-maintenance-wakeup.test.mjs
python3 reports/20261007-em-export-maintenance-drain/round3/negative.py \
  --out target/em/round3-negative-replay --cpus 80-83
cargo build -p snapback4
```

Use fresh output directories for each cohort. The negative helper creates a
fresh scratch source copy in this worktree's target directory; it never edits
the production source. It uses this worktree's Cargo target and therefore leaves
`target/debug/snapback4` as the mutant until a subsequent ordinary `cargo build`.
Always run real qualification against the positive pinned copy. This round
rebuilt the ordinary binary after the control and verified its final hash.
