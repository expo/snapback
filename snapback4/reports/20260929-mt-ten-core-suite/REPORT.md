# Lane MT — ten-CPU publication suite

The complete suite passed **twice on ten CPUs, then once unpinned**, on the
same final source: **2,064 s, 2,080 s and 1,254 s**, with zero failures or
cancellations. The unmodified baseline also passed on this Linux host; the
historical M1 timeouts did not reproduce here. Repeated runs exposed three
separate existing fixture defects, corrected before final qualification.

## Change and scope

`scripts/test.sh` gives the 222 client files outside the dedicated model stage
one shared Node pool with
`max(1, min(24, floor(os.availableParallelism() / 3)))` slots. That is three
slots on ten available CPUs and 24 on 96. Each slot also has to accommodate
the file's server, native devices, workers and browser renderers. Acquisition
and server-e2e no longer add seven independent shard processes outside the
file limit. The explicit serial override still selects one slot.

The old load heuristic reported 28.23 load across 96 CPUs during the pinned
baseline. It was measuring the whole host rather than the ten CPUs available
to the suite. The new rule uses available CPUs directly. Rust still drains
before clients, and the two model files retain their separate serial slot.

No product source, assertion predicate, timeout, model count, runtime meter,
dependency, package version or wasm budget changes. The retention fixture now
declares valid alternate keys and captures replacement notifications in its
existing subscription instead of sampling a transient state between events.
The reset fixture supplies the real query reply metadata for its literal reads:
explicit empty dependencies and the fixture's sequence 10.
Both browser files named by the ticket already run their subtests sequentially.
The dedicated model helpers already use controlled clocks. A two-slot trial,
focused diagnosis and a repeated full run exposed three existing fixture races.
Each reproduced against the unchanged test and was corrected before final
qualification; see
[FAILURES.md](./FAILURES.md).

The two-slot trial was unnecessarily conservative: its client stage took
1,548 s versus 440 s in the old default. Three slots allow a third file to
make progress while two long files run, while still reserving capacity for
each file's child processes. All 222 files use that common limit.

## Runs

All full-suite runs unset `SNAPBACK4_RUST_TEST_PROCESSES`,
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES` and `SNAPBACK4_BIN`, use the publication
SQLite flag and retain full seed counts. [METHOD.md](./METHOD.md) gives the
command, source and resource limits; [environment.json](./environment.json)
records tool versions and inherited Cargo profile inputs.

| Run | Available CPUs | Client slots | Result | Whole suite | Rust stage | Client stage | Models |
|---|---:|---:|---|---:|---:|---:|---:|
| Unmodified baseline, cold worktree | 10 | Node default + 7 shards | 0 failures | 1,953 s | 1,057 s | 440 s | 334 s |
| Diagnostic trial, before fixture fixes | 10 | 2 | 1 failed test | 2,465 s | 607 s | 1,548 s | 299 s |
| Intermediate three-slot run, before reset fix | 10 | 3 | 0 failures | 1,996 s | 623 s | 1,058 s | 304 s |
| Repeat before reset fix | 10 | 3 | 1 failed test | 2,027 s | 645 s | 1,059 s | 311 s |
| [Final, pinned 1](./proof-10cpu-1.log) | 10 | 3 | 0 failures | 2,064 s | 661 s | 1,083 s | 308 s |
| [Final, pinned 2](./proof-10cpu-2.log) | 10 | 3 | 0 failures | 2,080 s | 637 s | 1,109 s | 323 s |
| [Final, unpinned](./proof-unpinned.log) | 96 | 24 | 0 failures | 1,254 s | 537 s | 385 s | 320 s |

The baseline and all three final runs have the same inventory:
273 Cargo test binaries, 986 scheduled executions;
4,305 passed / 33 ignored. Clients: 4,858 passed / 10 skipped. Models:
79 passed, including 5,000 online session sequences, 5,000 local session
sequences and 3,000 online-client sequences. Fixture wrapper: 9 passed.
No failures or cancellations. Ignored/skipped cases are inherited, not new.
The ten client skips comprise one macOS media test and nine opt-in managed,
legacy-binary or published-fence fixture tests. Their complete names and
reasons are retained in `baseline-summary.json`; no environment override
was added to cause a skip. These runs do not qualify those conditional lanes.

## Failures and the M1 examples

There were **no failing or timing-out tests in the baseline**, so there are
no baseline failure durations to list. The two-slot trial subsequently failed
one pre-existing fixture test; focused diagnosis exposed a second, and the
repeated three-slot suite exposed a third. One unsuccessful test-only candidate
is classified as ours. Every failure and reproduction, duration,
existing limit and classification is in [FAILURES.md](./FAILURES.md). No
assertion was weakened and no timeout was raised. All three final runs passed
these cases and the complete suite.

| Baseline test | Duration | Existing timeout | What it actually waits for |
|---|---:|---:|---|
| `web admission review: recovery and transport respect the session boundary` | 125.125 s | 180 s parent | Sequential browser recovery, persistence and transport-boundary cases |
| `a peer logout commits before the next lock holder and refuses a click captured from a stale mirror` | 0.948 s | Within 120 s parent; no independent test timeout | IndexedDB commit under the session lock, stale admission rejection and authority withdrawal |
| Online session state machine, 5,000 sequences | 117.021 s | 240 s | Complete every generated sequence and assert full coverage |
| Local session state machine, 5,000 sequences | 154.527 s | 240 s | Same, with the local device and controlled recovery clock |
| Online clients, 3,000 interleavings | 58.385 s | 180 s | Complete generated wire/storage schedules and coverage assertions |

Final durations for the same cases (seconds; limits unchanged):

| Case | Ten CPUs, run 1 | Ten CPUs, run 2 | Unpinned |
|---|---:|---:|---:|
| Admission review | 128.801 | 127.523 | 131.352 |
| Peer logout | 1.084 | 1.015 | 1.028 |
| Online session model, 5,000 sequences | 89.565 | 95.782 | 89.064 |
| Local session model, 5,000 sequences | 147.510 | 163.828 | 156.681 |
| Online-client model, 3,000 interleavings | 67.044 | 60.012 | 69.705 |

Machine-readable counts, stage timings, peak samples and raw-log digests:
[pinned 1](./proof-10cpu-1-summary.json),
[pinned 2](./proof-10cpu-2-summary.json),
[unpinned](./proof-unpinned-summary.json).

The two historical Rust failures were already fixed by `4a1e30ca7` on the
merged baseline. Their containing targets passed here. Passing Rust harnesses
do not emit individual test durations; this report does not substitute target
durations for those tests. The M1 ticket's original model failure names and
durations were not available in this checkout; they are not reconstructed
from passing Linux runs.

## Compile warm-up for the M1 kit

After cutting/bumping the publication worktree, and only while calibration
is not using the M1, run from that worktree's `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  cargo test --workspace --no-run
```

Use exactly the dry run's Rust toolchain, target directory, default test
profile/features, `RUSTFLAGS` and Cargo profile environment. A production or
release-profile build does not populate this test inventory. Keep the cache
in the publication worktree. The ordinary dry run must still execute
`scripts/test.sh`; warm-up supplies no qualification receipt and skips no
test. The Rust runner already requests this same complete inventory using
Cargo's JSON artifact stream and runs doctests separately.

Measured here: the cold inventory compilation took **423 s**. An explicit
subsequent `--no-run --message-format=json-render-diagnostics` took **0.25 s**
wall time (Cargo reported 0.09 s); all **273** test binaries were `fresh`,
with no rebuilt executable. The first modified suite's inventory preparation
still took 14.79 s after its preceding build/check steps, so warming is not
a promise of zero preparation work. See `warm-summary.json` and the warm-up
logs. The baseline's longest Rust target was device `row_view_disclosure`,
513.8 s: prewarming cannot remove actual test execution time.

## Wasm and limits

The baseline build is **2,042,203 B raw / 593,573 B gzip-9 file input**,
146 B below the unchanged **593,719 B** cap. SHA-256:
`75104fe4882479ef2bfd8796df9d655853739084640c11457cffbb50309a6e2c`.
All intermediate and final rebuilds were byte-identical. Comparisons are against
this worktree's rebuilt baseline, not a different host/path's historical gzip.

The baseline's sampled cgroup memory peak was 26,556,026,880 B (24.73 GiB),
below its 64 GiB cap, with swap disabled. Final sampled peaks were
16,662,876,160 B (15.52 GiB), 17,464,164,352 B (16.26 GiB) and
24,855,986,176 B (23.15 GiB), respectively, under the same limits. This is an
affinity-constrained Linux qualification, not a Darwin dry run or a
reproduction of M1 single-core speed. No artificial ambient memory load was added. The M1 was not contacted
or loaded. Its host ticket remains open until a real M1 publication record.

## Checks and disposition

Shell/JavaScript syntax and whitespace checks pass. The final source hashes
match `environment.json`; all twelve failed diagnostic executions match
`failure-executions.json`. The reference audit, including the
new suite and fixture annotations, passes: 523 LLP documents, 9,893 references,
zero errors/unchecked. [CONTEXT.md](./CONTEXT.md) records the scoped LLP
orientation. Bun dependencies/cache, LLP skill checkout and diagnostic helpers
are local to this worktree; installed tools and Chromium were reused. No tool
was installed on a shared path. No push or publication.
