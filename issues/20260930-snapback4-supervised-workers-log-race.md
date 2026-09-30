# Snapback 4 supervised-workers test observes files before relayed logs

Status: Open
Scope: `snapback4/packages/snapback4/test/supervised-workers.test.mjs`
Found: 2026-09-30, NS round 2 full suite on eb1000
Classification: baseline test synchronization race (present in NS round 1)

`dev declares two workers, injects usable secret seats, restarts independently
and stops both` waits for both `starts-*.jsonl` files, then immediately asserts
that the parent has received each worker's authentication log. A worker writes
its log before its file, but the relayed pipe and the filesystem are separate
observation channels. Seeing the file does not mean the test's stderr data
callback has run. The full-suite failure occurred at line 68 after 205 ms:
both files existed, while `[worker:push] authenticated:push` had not arrived.

The worker implementation and the test are byte-identical to NS round 1
`2f2154e7ba`. The unmodified focused round-1 test passes on the Mac. A separate
report control holds only delivery of the push authentication log for 250 ms,
leaving startup files and all product behavior unchanged. It reproduces the
same assertion failure with both the hash-bound round-1 and round-2 binaries.
This demonstrates the missing synchronization, not a worker authentication
failure. No production code or test assertions were changed for this ticket.

Follow-up: use the existing bounded `until` to observe the required log lines
before asserting their exact contents, while retaining file, seat, redaction,
independent-restart, ledger and cleanup assertions. Add a delayed-log-delivery
control so the file observation cannot substitute for pipe observation.

Evidence: [NS round 2 report](../snapback4/reports/20260930-ns-native-smoke/round2/REPORT.md),
`worker-baseline-source.json`, `worker-race-control.py`,
`worker-race-control.test.mjs`, both `worker-race-*.log.gz`, and the original
`full-suite.log.gz` in that report directory. Nothing pushed or published.
