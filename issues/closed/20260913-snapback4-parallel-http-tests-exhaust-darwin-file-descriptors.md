# Snapback 4: parallel HTTP tests exhaust Darwin's default file-descriptor limit

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-13
**Systems:** Snapback 4 HTTP test harness
**Author:** Codex / GPT-6
**Resolution:** Fixed by `c4eb1047f`: bounded test processes pass the complete Rust inventory at Darwin's 256-descriptor limit.
**Related:** [LLP 3000](../../llp/3000-snapback4.explainer.md)

## Observation

On the Durand M4 Pro (Mac16,11), the unmodified 0.2.6 source
`342c53d306d7484cd64e820ee27a151e02eb4b0b` ran its production-profile host
tests with the default Rust test concurrency and `RLIMIT_NOFILE=256`.
Twenty passed and six failed. The log records `OS 24: Too many open files`
in `TcpStream::connect` and the vendored stream clone, followed by connection
resets and failed response/deadline assertions.

Running the same 26 baseline host tests with `--test-threads=1` at the
unchanged descriptor limit passed all 26 in 2.73 seconds. The 28 baseline
core tests also passed. The reader-QPSG candidate's 26 host tests passed
serially in 2.89 seconds. Explicit concurrency inside each test remains
enabled. These observations do not establish default-parallel qualification.

The existing `snapback4/scripts/test.sh` delegates to the default concurrent
Rust harness without accounting for the process descriptor budget. Make that
existing path reliable on this supported Mac environment while preserving
the connection/admission tests and the suite's time budget.

## Retained evidence

Run directory: `.llp/ship-runs/sb4-performance-20260913/reader-darwin/results/`.
`reader-darwin-build.log`, `.json` and `.exit` preserve the original failure;
`reader-darwin-serial.log`, `.json` and `.exit` record the successful serial
correction. The combined pre-measurement receipt is
`reader-darwin-qualified.json`, SHA-256
`5e1f073fb552873010edfcbea37c48deb8ecf1339be9cf7af502083c209e8597`.

## Resolution — 2026-09-17

The blocking runner now builds Cargo's authoritative test-artifact inventory
once and executes it through a bounded 24-process pool. Each process owns only
its own pipes and test state; ordinary host targets use two harness threads,
while the subprocess/listener-heavy binary and lifecycle targets use one.
Scale-heavy exact cases are isolated in their own processes. This preserves
parallel wall-clock progress without concentrating every concurrent listener
and cloned stream under one Darwin process's 256-descriptor ceiling.

Before this final form, an all-at-once current-main control reproduced OS 24
in newly added route coverage at `RLIMIT_NOFILE=256`. The bounded host-target
control then passed the full current host inventory at the same limit:
integration-target pass counts 58, 17, 27, 2, 31, 14, 20 and 1, followed by
65 binary tests and 20 lifecycle tests.

Pre-rebase checkpoint `53871af32b785c1284d1b00c081054d8adf6f26f` passed
the complete 67-binary Rust inventory under `RLIMIT_NOFILE=256` on
macOS 26.6.2 (18 logical CPUs, 128 GiB RAM; Node 25.9.0, Bun 1.3.12,
Rust 1.97.0). It passed 1,293 tests with four declared ignores and no OS 24 or
other failure; the now-exclusive macOS witness target passed 20/20 and
lifecycle passed 20/20. The 153-second loaded-host run is descriptor evidence,
not a blocking-budget claim. Raw log SHA-256:
`d58d20ec1b2342972daf0bf09030eb5026195866eca1cd350e377b68a83c39d6`.
The rebase to code checkpoint
`c4eb1047f9ac8ba3603fcb8bef76f6e71b010dd5` changed no Rust or test-runner
file from that executed checkpoint. Its exact controlled Linux blocking suite
passed in 52/50 seconds, so the descriptor repair does not trade away the
60-second budget or any HTTP/admission assertion.
