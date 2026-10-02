# FDL round 0 — descriptor limits, 2026-10-02

Branch `sb4-intent/fdl-fd-limit`; base `1687b58af2`, including CT merge
`67191e220d`. Linux host `expose-builder-pixel` (eb1000), 96 available CPUs;
inherited soft/hard NOFILE 1,024 / 1,048,576. Nothing pushed or published.

## Finding and change

The baseline needs more than 1,024 descriptors because libtest runs many
servers concurrently. In a measured whole-process run at soft 4,096, all 234
active tests passed (four existing ignores), and `/proc/<pid>/fd` peaked at
1,197 entries with 96 tests active. The peak snapshot includes 987 socket
handles. The same suite at soft 1,024 failed five tests, including an unchecked
socket clone panic with EMFILE. Its sampled peak of 956 is a lower bound: a
10 ms sampler misses shorter exhaustion bursts. Serial execution passed with
a peak of 249; late quiet intervals returned to three descriptors. No lasting
socket, pooled-request, or SQLite descriptor leak was found. Idle pooled jobs
are consumed (`FnOnce`), request guards release permits, and the ephemeral
publisher holds a weak owner reference. The new repeated lifecycle regression
also checks weak engine/admission owners and a return to its initial fd count.

Each bounded tiny_http connection owns a deadline socket, read/write halves
and an abort socket. Previously every request cloned another abort socket.
The baseline peak snapshot has 987 socket descriptors across 382 socket inodes; 149 inodes each have five descriptors. A patched snapshot has 144 inodes with four descriptors each. These are legitimate overlapping owners, not leaked handles. Requests now
share the connection's abort handle, avoiding one OS descriptor per active
request and making keep-alive request parsing independent of `dup` success.
The remaining connection clones propagate I/O errors; intake closes that
connection, releases the admission lease and continues accepting.

`dev` and `serve` now attempt once to raise soft RLIMIT_NOFILE to
`min(hard, 65536, platform ceiling)`, preserving an already higher soft limit.
The hard limit and all HTTP admission caps stay unchanged. Darwin's ceiling
is the smaller of OPEN_MAX (10,240) and `kern.maxfilesperproc`; if the sysctl
cannot be read, OPEN_MAX is the fallback. The current soft limit returned by
`sysconf(_SC_OPEN_MAX)` is deliberately not used as the ceiling. References:
[Apple's OPEN_MAX declaration](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/syslimits.h)
and [XNU's resource-limit implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c).

A failed raise is nonfatal and appears once in the startup line with its OS
cause. Live dev `doctor` reports the server's startup attempt separately from
its own process limits; offline doctor only observes. The shared unit-test
helpers call the same initialization through a Once before creating listeners.

## Orientation and constraints

Used `llp-orient` from the existing sibling checkout because this worktree's
`skills/llp-orient` symlink targets an uninitialized submodule. Read the Snapback
4 fence, NOT-DOING, journal tail, LLP 3000, LLP 2000.000, the adopted rules,
and the assets guide's admission text. Scope: host limits, tiny_http connection
construction, server test helpers, doctor, and the covering documentation.
The binding policy is [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#http-overload-diagnostics)
and its [request-pool policy](../../../llp/3000-snapback4.explainer.md#contended-read-serving).
Admission stays at 128 connections, two uploads, and the existing per-class
request limits. Startup cannot become contingent on raising an OS limit.
No core/device semantics or wasm budget change. LLP 3000 and the guide are
updated with the code. No new LLP or process gate is introduced.

## Measurement method

`profile.py BINARY PREFIX SOFT [libtest arguments...]` preserves the hard
limit, sets only the child's soft limit, and samples `/proc/<pid>/fd` and task
counts every 10 ms. It captures libtest JSON events using
`RUSTC_BOOTSTRAP=1 -Z unstable-options --format=json`; test scheduling and counts
are unchanged. JSON files retain command arguments, executable hash, per-test
process peaks, peak fd targets and suite result. CSV files retain the complete
sample series. Descriptors in subprocesses are not included in the parent count.
Snapshots race descriptor close/open and are descriptive, not atomic censuses.

`baseline-per-test.csv` gives each test's process peak in the serial suite;
there is no overlap between active tests, but detached cleanup can overlap the
next test briefly. Representative peaks: atomic feed adoption 249, saturated
legacy waits 208, saturated mutation admission 207, full poll admission 106,
route wait capacity 100. The repeated many-server regression runs alone in a
child starting at soft 256, holds more than 1,024 descriptors, drains every
connection, drops engines/admission, and returns to its initial descriptor
count for three cycles. It also verifies that the hard limit is unchanged.

## Qualification

All affected final checks pass: 2 descriptor-policy unit tests, 2 HTTP streaming tests, the three-stage EMFILE regression, 27 lifecycle tests, the repeated many-server regression, and 110 guide tests. Each affected command and the guide started with soft 1,024. The exact host-limit module type-checks for aarch64-apple-darwin; macOS runtime execution was not available on this Linux host.

The required direct whole-binary matrix, using a stable executable copy after builds drained, is below. Each cell includes all tests in one process and four existing ignores. Hard NOFILE remains 1,048,576. No valid patched run observed EMFILE.

| Run | Soft 1,024 | Soft 256 |
|---|---|---|
| 1 | 237 passed, 0 failed | 237 passed, 0 failed |
| 2 | 236 passed, 1 failed; baseline witness lock | 236 passed, 1 failed; baseline witness lock |
| 3 | 237 passed, 0 failed | 237 passed, 0 failed |
| 4 | 237 passed, 0 failed | 236 passed, 1 failed; baseline witness lock |
| 5 | 237 passed, 0 failed | 237 passed, 0 failed |

These `commit-*` runs use SHA-256 `04d8f011227990c199aa015890135628c55ffebd6619427012d8ec9a32baa3db`, exactly the binary built and passed by the complete suite. Run times are 6.5–7.4 seconds including observation overhead. All three failures are the same baseline witness-lock refusal; none is a descriptor failure.

[RESULTS.md](RESULTS.md) records every exploratory, baseline, serial and final attempt, with exact times, fd peaks and links to raw logs. [FAILURES.md](FAILURES.md) enumerates every failed test and classification. The witness failure reproduces in the unmodified baseline at soft 4,096; it is tracked in [this filesystem issue](../../../issues/20261002-snapback4-unit-witness-owner-race.md). The timing assertions pass in isolated baseline and patched controls; contention remains a limitation of those tests.

The full `scripts/test.sh` invocation started with shell soft 1,024. Node can raise its own inherited limit, so the direct executable matrix independently enforces both requested low entry limits. The suite ran **once**, exited 0, and printed exactly **`== 0 failure(s) in 1506 s`**. Every category passed: all Rust targets and doctests (including binary 237/0 with four ignores, lifecycle 27/0 and guide 110/0), fixture checks, both app typechecks, 5,768 client tests with ten skips, and all 79 final models. There are **no full-suite failures** to classify. See [full-suite.log](full-suite.log) and [full-suite-environment.log](full-suite-environment.log).

Wasm from that suite: **2,032,879 B raw / 610,171 B gzip**, against the unchanged **610,782 B** ratchet, leaving **611 B**. This lane changes no device source or budget; no independently measured byte delta is claimed.

Doctor uses its existing live-dev inspection path. `doctor --release` retains its existing offline behavior; the `serve` process reports its attempt in its startup log. This change does not add a production inspection endpoint.

## Failure ledger

All attempts, including invalid measurement attempts, are retained. Baseline
failures, environmental timing failures and our harness mistakes are not merged
into a green result. Detailed result tables follow.

Final reference audit: 525 LLP documents, 10,084 references, zero errors or unchecked references (`ref-check-final.log`). Source/document whitespace checks pass; raw libtest logs retain their original trailing blank lines, which produce nine `git diff --check` blank-at-EOF warnings when raw logs are included.
