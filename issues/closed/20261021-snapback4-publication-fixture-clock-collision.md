# Snapback 4: parallel publication fixtures can choose the same clock tick

Status: Resolved
Date: 2026-10-21
Scope: snapback4-device/src/device/publication_tests.rs::with_sqlite

Integration 21's Mac Studio run on source 4b824a6fe6 (Xcode 27.1, iOS 27.0
installed) observed AlreadyExists at create_dir in the parallel device library:
62 passed, 1 failed. The helper named a directory using only the process id and
SystemTime nanoseconds. Parallel callers can observe the same clock tick on
macOS; no application store or runtime authorization failed.

Resolution: include a process-wide relaxed AtomicU64 serial in each fixture name,
retaining the timestamp and process id. No timeout, assertion, storage operation
or production code changed. The helper is compiled only for tests. The affected
Mac target and complete Linux repeat are required after this repair; their
results are recorded in WORKSTREAM-REPORT.md and Integration 21 evidence.

Evidence: ~/sb4-loop/integration21/mac-final37.log and the owned Mac scratch's
integration21-logs/merged-device.log (original failed run retained), followed by
mac-device-fixed.log and final-rust-5.log. This does not resolve the independent
resolver/readiness issue 20261016-snapback4-unit-cleanup-and-resolver-readiness-flakes.
