# Snapback 4: CLI latency snapshot concurrency test fails under CPU load

Status: Open
Date: 2026-10-08
Scope: `serve::latency::tests::snapshot_of_ten_thousand_operations_does_not_serialize_recording`

One of FS's five unchanged whole-CLI runs failed this test under six busy loops on CPUs 74–75, four libtest threads. The same signature also occurs in the lease-test-only candidate. The baseline failure is `record stalled: 13.017954ms` at `tests/latency/histogram.rs:149`. This test and its implementation are unchanged by FS; the test's wall-clock relationship around real work remains a separate follow-up. Passing repetitions do not close it. Preserve all operation counts and recording/concurrency assertions; investigate with a controlled snapshot/recording barrier rather than raising a timing bound.

Evidence: [FS report](../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md), `baseline-whole-unit/` and `fixed-whole-unit/` compressed logs.
