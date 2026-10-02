# Round-4 failure ledger

## Superseded candidate

The [rejected wall-time candidate](./wall-paced-candidate/README.md) retains its
exact source, all completed observations and every qualification failure in its
[ledger](./wall-paced-candidate/FAILURES.md). Its complete suite ran once and
reported exactly **`== 2 failure(s) in 1561 s`**: `wasm build` and `client tests`.
The 24 inherited cached-main wasm reply mismatches and oversized stale artifact
were environmental and cleared after a scoped cache repair. The remaining
site-48 follow fault-injection reachability failure is the operator's already
ticketed baseline harness flake. Its corrected development errors were ours.
None of those failures is erased by rejecting its pacing policy.

**Ours, excessive pacing cost, corrected before final qualification:** wall-time
pacing charged CPU descheduling as work and imposed a 1 ms minimum on cheap or
empty turns. The 144-process mixed Following cell still had 694 of 1,000 tasks
pending roughly fourteen minutes into its drain. It was intentionally stopped;
exit 143 is an aborted/incomplete experiment, not a passed cell or a natural
30-minute assertion failure. The three completed Following cells, eight small
mixed cells, supplemental SQLite check and passive scheduler counters remain.
Final pacing uses thread CPU consumption and has no minimum pause; fresh timing
does not pool any rejected-candidate samples into the final design.

## Measurement diagnostics

**Ours, corrected diagnostic path:** the first supplemental read-only check of
`drain-paced-0-1` used an extra `replay-instance/` component and failed with
SQLite error 14 before opening any database. The corrected path is the work
root's `.snapback4/store.sqlite`. That one successful supplemental observation
found 425 pending tasks at Unix ms 1790930699140 and took 76.403 ms. It is kept in
`drain-paced-0-1-progress.json`; it is not a latency sample or a drain endpoint.
The ordinary observer and all probe samples remain unchanged and retained.

## Final source

**Ours, log archiving race, recovered without a suite restart:** `archive.py`
compressed and unlinked the live `test-sh.log` after timing while the suite was
already running. The suite retained its original open output inode. A collector
opened `/proc/602026/fd/1`, copied from byte zero, and followed it through the
suite exit into the restored `test-sh.log`. The initial compressed fragment is
retained as `qualification/test-sh-initial-fragment.log.gz`; its bytes must match
the restored log's prefix. The archiver now excludes qualification directories.
This affects log custody, not source or test execution; no test was restarted.

The **one complete-suite invocation on final source** finished with exit 0 and
exactly **`== 0 failure(s) in 1417 s`**. There are **no final-suite test failures**:
all Rust targets and doctests, fixture tests, guide/docs/typechecks, 5,742 client
tests (10 skipped), and 79 client models passed. The known follow fault-injection
case passed in this run; neither the matrix nor the full suite was repeated.
There were two total complete-suite invocations across the two different pacing
sources, as documented above. Earlier failures remain part of this ledger.

The final suite rebuilt the lane's correct wasm: 2,015,329 B raw / 605,002 B gzip,
223 B below the unchanged 605,225 B ratchet. `wasm.json` records its digest and
the absence of archived-main paths in the dependency record. All final affected
checks, doctor controls and 28 timing cells also exited 0. Source and measured
binary hashes still match `custody.json`; the raw log is retained in
`qualification/test-sh.log` with exit 0 beside it. The log has 921,459 bytes;
its initial 8,257 bytes exactly reproduce the fragment archived during the run.
