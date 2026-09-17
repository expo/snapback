# Snapback 4: parallel HTTP tests exhaust Darwin's default file-descriptor limit

Status: Open
Priority: P2
Date: 2026-09-13
Systems: Snapback 4 HTTP test harness
Author: Codex / GPT-6
Related: [LLP 3000](../llp/3000-snapback4.explainer.md)

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
