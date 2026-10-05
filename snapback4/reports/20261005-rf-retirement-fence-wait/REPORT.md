# RF — retirement fence setup wait (2026-10-05)

**Fixture timing assumption; no product change.** Base
`2cb702e8adf9a9b2dc32104a1b57cae95afbccd8`, branch
`sb4-intent/rf-retirement-fence-wait`. Everything ran on eb1000
(`expose-builder-pixel`) in this worktree. Nothing pushed.

## Diagnosis and change

`Supervisor::start` independently calls `DevWorker::tick`, then parks for
100 ms. Advancing the test clock sends no notification and needs no HTTP
request. Rotation starts when either monotonic child age reaches one day
minus two seconds or host time reaches the recorded child expiry minus two
seconds. It stops the child **before** retiring its credential; the watchdog
allows two seconds of graceful termination, then kills the remaining group.
Scheduling, previous worker turns and the engine writer queue add time.
The 100 ms park is a cadence, not an end-to-end latency bound; retirement
retries back off from 250 ms to at most five seconds.

[LLP 3000.009 §5.3](../../../llp/3000.009-general-purpose-backend.rfc.md#53-supervision-and-isolation)
requires advancing the retiring revision **before returning deletion failure**,
retaining retirement custody before replacement, and keeping manual seats live.
It does not promise fencing within two seconds of a clock advance.
Ordinary authentication checks expiry independently; this fixture extends
stored sessions by a day so expiry cannot accidentally satisfy its fence checks.
Its SQLite busy timeout is 5 ms, making the external writer fail the DELETE
once the supervisor reaches it.

The test now uses its existing `wait_setup`: a **60-second per-stage hang
guard**, polling every 5 ms and returning immediately on progress. This
matches the adjacent startup/queued-turn bounds and
[LLP 3000's contention policy](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention).
Timeout unwinding drops the external SQLite holder before joining supervision.
All outcomes remain: fence advances; old read bearer, mutation and refresh
return 401 while the sessions remain unexpired; manual seat returns 200;
a changed replacement bearer becomes ready and authenticates. Conventional
and named workers both run. The separate two-second adoption read-latency
assertions under [LLP 3000.019 §3.6](../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#36-p10-adding-a-view-never-stalls-reads)
are unchanged. Orientation hand-off: none; existing contracts cover the fix.

A new regression delays the first retirement DELETE's SQLite authorizer
callback by **2,200 ms**, then allows the real external lock to cause failure.
It asserts the delay occurred and runs both worker forms. No production hook.

## Audit

Searched `src/serve*.rs`, all `tests/serve*/` modules and their latency children
for count-bounded sleep loops, sleep-then-assert patterns and worker setup waits.
This was the only remaining short supervisor-turn loop. Preserved:

- Existing `wait_setup` worker barriers; separate HTTP admission/metric waits.
- Two 1,050 ms route sleeps that intentionally expire one-second leases.
- Slow-upload pauses, 200 ms socket holds after observing a response byte,
  and the maintenance sleep that tests exclusion of sleep from CPU accounting.
- The ten-second refusal-evidence predicate wait.

Client server/adoption and supervised-worker spot checks found positive worker
readiness/restarts using `awaitState`; remaining sleeps inject faults or observe
no extra work after an already observed state. No additional fix was needed.

## Verification

Every stress row used a normal-priority Python busy loop and the Rust test
pinned to **CPU 9**, 50 serial invocations, `--exact --nocapture
--test-threads=1`, with a 180-second outer guard. Only the recorded hog PID
was stopped/reaped. Initial CPU 9 utilization was 2%. Node was 24.13.1;
builds used the publication flag
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

| Condition | Passed | Failed | Failure rate |
| --- | ---: | ---: | ---: |
| Unmodified test + hog | 50 | 0 | 0% |
| Fixed test + hog | 50 | 0 | 0% |
| Original wait/assertions + 2.2 s delay + hog | 0 | 50 | 100% |
| Fixed delayed regression + hog | 50 | 0 | 0% |

Every delayed old-wait failure is the reported fence assertion (exit 101).
That temporary mutant adds the delay fixture while retaining the original loop
and assertion order; it fails on the first, conventional worker. Fixed runs
exercise both forms. CPU load alone did not reproduce Darwin's failure;
the controlled delay did. The mutation was removed before qualification.

Affected `cargo test -p snapback4 --bin snapback4 serve:: -- --test-threads=1`:
**181 passed, 0 failed, 4 existing ignores**, 35.64 s, CPUs `10,16,56,59,65`.
`./ref-check --verbose`: **528 LLP docs, 10,395 refs, zero errors**.
Wasm rebuilt to **2,117,335 B raw / 639,807 B gzip**, within the unchanged
639,941 B budget. No wasm source changed.

Full suite: **completed with one failure** (`cargo test`), exit 1 in
**5,871 s**. All 320 client files passed (6,370 tests, 11 skips), both serial
model files passed (79 tests, including both 5,000-sequence session tiers and
3,000 online-client interleavings), and the other suite stages passed. Command:

```sh
taskset -c 72,73,74,76,77,84 env CARGO_BUILD_JOBS=6 \
  LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  bash snapback4/scripts/test.sh
```

Those CPUs measured 2.5–9.5% busy before launch. The cold workspace test build
alone took 19m 01s; this is not a warm latency measurement.

The CLI unit target reported **296 passed, 1 failed, 4 ignored**:
`verbs::witness::preparation::cleanup_tests::stopped_supervisor_without_exits_requires_recovery_and_keeps_its_deadline`
received `E_WITNESS_PROCESS: invalid /proc process group` at
`preparation.rs:197`, instead of the expected cleanup timeout. The unchanged
native parser has an [existing open issue for this signature](../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md).
Three isolated runs on the original binary and three on the fixed binary all
passed. An entire original CLI unit run also passed (296 tests, four ignores,
57.96 s, newly idle CPUs `17,64,65`). These controls **do not reproduce the
failure on baseline or erase the suite failure**. Its rejected `/proc` snapshot
was not retained; the precise cause remains unproven. No ownership check changed.

Raw logs, per-run results, fixture snapshots and `stress.py` are retained in
`snapback4/target/rf-evidence/`; the original/fixed/mutant executable snapshots
are `target/debug/deps/rf-{original,fixed,original-delay}-test`. The two test
names are under `serve::tests::adoption_tests::worker::`:
`serve_rotation_fences_a_valid_credential_while_retirement_is_locked` and
`serve_rotation_waits_for_a_delayed_retirement_turn`.
Final worktree footprint, including all build artifacts: **23 GiB** (`du -sh .`),
below the 40 GB limit. No other worktree or host was used, and only owned test
processes were stopped.
