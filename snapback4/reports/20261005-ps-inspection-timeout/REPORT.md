# PS — process inspection on large hosts

2026-10-06; eb1000 (`expose-builder-pixel`), Linux; base `4f0477b7af`.
Experiments and focused checks used `taskset -c 56-79`. After the session
interruption, a fresh idle-CPU sample selected `taskset -c 0-31,48-79`
for the resumed full suite; the existing build cache was reused. Linux 6.8.0-138, procps-ng 4.0.4, Node 24.13.1, Bun 1.3.14.
No remote host, unrelated process
mutation, push or publication.

## Reproduction and measurement

The original injected `run` launched a Node child which waited 3.1 seconds
before writing a valid listing, using the supplied spawn options. It failed
after **2,005.6 ms**, with one 2,000 ms attempt and `TEST_PROCESS_INSPECTION`
wrapping `ETIMEDOUT`. The Round 0 regressions delayed a real full `ps` by
3.1 seconds: the first attempt times out, and a fresh second attempt succeeds.
They cover both pre-release enumeration and cleanup verification.

Seven real `LC_ALL=C ps -axo pid=,ppid=,pgid=,uid=,lstart=,stat=,comm=`
samples per population, with the same samples repeated without `lstart`:

| Observed processes | Full columns, median ms | Without lstart, median ms |
| --- | ---: | ---: |
| 1,169–1,172 | 47.257 | 44.235 |
| 2,172–2,176 | 96.377 | 93.682 |
| 6,171–6,175 | 293.893 | 289.902 |
| 11,172–11,178 | 530.598 | 529.375 |

The additional 1,000/5,000/10,000 processes were tiny C children blocked on a
pipe. Closing our pipe released them; their parent reaped every child and
exited zero after each population. No signals or controls targeted other
sessions. [Raw samples](./ps-measurements.json) retain counts and wall times.

Linux did **not** reproduce a two-second listing at 11k rows. The reported M5
failure did; these Linux measurements cannot establish Darwin throughput.
Two seconds for 11,000 rows permits only about **182 µs per row**, including
enumeration and formatting overhead. The supplied Darwin result exceeds that
budget; its actual completion time remains unmeasured. The 60-second retry
allows 30× the original budget, while keeping a finite fail-closed limit.

## Round 0 repair (accounting superseded by Round 1 below)

Only `ETIMEDOUT` retries, once, at 60 seconds. Partial output is discarded;
repeated timeout, nonzero exit, empty output and other command errors still
fail with `TEST_PROCESS_INSPECTION`. The three-fresh-snapshot transient-routing
retry, first-error preservation, C locale and 16 MiB limit remain intact.
At worst each routing snapshot takes two bounded commands (2 + 60 seconds);
three routing snapshots permit six commands plus two 50 ms waits.

Keep the full-table `lstart`: candidate-only metadata would split routing,
start identity and exit-state validation across separately changing tables.
No new PID-reuse/identity argument justifies that optimization here.

Synchronous inspection blocks progress IPC for every file in the pool and can
also delay the keeper's cleanup pipe EOF. A shared clock now excludes time in
`processTable` from stall and cleanup wait accounting. Each watchdog rechecks
that clock; completed/stopped files ignore late progress. Wall elapsed remains
wall time. Cleanup still requires two fresh empty snapshots 50 ms apart and
fails on observed non-keeper leftovers; its five-second wait window excludes
inspection time, while each listing retains the bounded command policy.

## Round 0 verification

The isolated original runner fails all three recovery/shared-watchdog
regressions ([pre-fix log](./pre-fix.log.gz)). Restoring only the old cleanup
wall clock also fails the slow cleanup case ([log](./old-cleanup-clock.log.gz)).
The shared-watchdog control delivers queued IPC after the overdue
timer, reproducing a false hang despite all 15 native subtests passing.

The final focused command passed **89/89**, zero skips, in 40.772 seconds
after resumption ([log](./focused.log.gz)):

```sh
taskset -c 56-79 node --test --test-reporter=tap \
  snapback4/packages/snapback4/test/test-file-runner.test.mjs \
  snapback4/packages/snapback4/test/test-processes.test.mjs
```

`taskset -c 56-79 ./ref-check --verbose`: 528 LLPs, 10,418 references, zero
errors or unchecked references. `git diff --check` passes.

The resumed full suite passed: **0 failures in 1,473 seconds**, exit 0
([complete log](./suite.log.gz)):

```sh
taskset -c 0-31,48-79 bash snapback4/scripts/test.sh
```

All build/typecheck/fixture stages, 1,012 native executions plus doctests,
**322/322 client files** (6,452 passes, 47 declared skips), and both full-count
serial model files (**79/79**, zero skips) passed. The client pool used 21
slots on 64 affinity-visible CPUs. The focused tests and LLP reference check
were rerun after resumption; the interrupted run is not a completed suite
qualification. Logs stayed under the existing ignored target directory; the
retained gzip evidence is small.

Wasm/product code, test seeds, ownership and keeper-only signaling are unchanged.
This is Linux verification and injected Darwin-shaped inspection coverage;
no new Darwin publication qualification is claimed.

## Round 1 — monotonic cleanup and watchdog deadlines

Base `da6e7d9772`. Astra's P1 review found that concurrent persistent groups
could spend each other's polling interval in inspection, advancing the shared
discounted clock almost not at all. Remove that clock, its accumulator and all
discounting. Cleanup and progress watchdogs use `performance.now()` throughout;
completed/stopped files still ignore queued progress. The 900-second production
stall floor already exceeds a 60-second listing. Synchronous calls can delay a
callback until they return, but cannot renew either deadline. Cleanup that
cannot establish two empty snapshots within its retry window still refuses.
The bounded ps retry, full-table identity, routing retries and fail-closed
diagnostics are unchanged.

The replacement regression runs two real persistent groups with no-op cleanup
release callbacks alongside a genuinely blocked native test with a one-second
watchdog. Each injected listing sleeps 100 ms before running real ps, longer
than the other cleanup's 50 ms polling sleep. The fixture closes only its own
group pipes and verifies all three groups have exited. Against Round 0, its
eight-second safety guard was necessary and the hung file failed only after
**10.426 s** ([red log](./round1-red.log.gz)). With the fix, the hung file fails
in **2.778 s**, both cleanups refuse as `TEST_FILE_LEAK` after **5.242 / 5.146 s**,
and the guard never fires. Assertions bound these at four and seven seconds.
Under the full suite's 21-file concurrency, the same regression passes at
**2.904 s** for the hung file and **5.175 / 5.072 s** for cleanup, again without
the safety guard.

The artificial queued-progress test that required a discount is replaced by
this regression. Both real delayed-ps recovery phases remain: their delay is
now 2.1 s, so the two-second timeout plus successful retry fits the existing
five-second cleanup window. Repeated timeout and nonzero-exit cases still
require `TEST_PROCESS_INSPECTION` even when every native test passes.

Focused verification: **89/89**, zero skips, **43.676 s**
([log](./round1-focused.log.gz)), using `taskset -c 56-63,66-79` and the same
two-file command above. LLP reference validation again reports zero errors
or unchecked references. Full-suite verification uses
`taskset -c 0-31,48-63,66-81 bash snapback4/scripts/test.sh`, selected after a
fresh idle-CPU sample on eb1000. It passed with **0 failures in 1,486 s**, exit 0
([complete log](./round1-suite.log.gz)): all 1,012 native executions and doctests,
**322/322 client files** (6,452 passes, 47 declared skips), and **79/79** serial
model tests. Native tests took 464 s, client files 653 s, and serial models 325 s.
`git diff --check` passes. No product/Wasm source, seeds, remote host, unrelated
process, push or publication is involved.
