# Snapback 4: process inspection times out on large process tables

**Opened:** 2026-10-06
**Closed:** 2026-10-06
**Status:** Closed — bounded timeout recovery with monotonic deadlines
**Area:** Snapback 4 client test runner / publication qualification
**Related:** LLP 3000 §7, publication suite under contention

The 0.4.14 Darwin publication dry run, attempt 1, failed
`subscription-pressure-e2e.test.mjs` after both native tests passed.
`ps -axo pid=,ppid=,pgid=,uid=,lstart=,stat=,comm=` exceeded its fixed two-second
budget on the M5's approximately 11k-process table. Cleanup correctly refused
as `TEST_PROCESS_INSPECTION`, but the budget excluded legitimate large hosts.

`ETIMEDOUT` now discards partial output and retries once at 60 seconds. A failed
retry and every other command failure still refuse. Full-table identity,
metadata validation, the three-fresh-snapshot routing retry, and keeper-only
signaling remain intact. Round 1 removes the shared inspection-time discount:
the file watchdog and cleanup use monotonic time so concurrent persistent groups
cannot freeze either deadline. Two fresh empty group inspections remain required.

Round 0's 89 focused regressions passed, including real delayed-command recovery in
both inspection phases, repeated timeout and nonzero-exit refusals, and queued
progress delivered after an overdue watchdog callback. The original runner
fails the three recovery/progress regressions; restoring its cleanup clock
alone also fails slow cleanup. On eb1000, a real 11,178-row table completed in
about 531 ms median; that Linux result does not qualify Darwin throughput.

Full-suite results and retained logs are in the
[PS report](../../snapback4/reports/20261005-ps-inspection-timeout/REPORT.md).
No remote host, other session's process, push or publication was involved.

Complete-suite verification after resumption: exit 0, **0 failures in 1,473 s**;
all 322 client files and both full-count model files passed.

Round 1 addresses Astra's P1 review of `da6e7d9772`: two concurrent unresponsive
groups must both reach their five-second cleanup deadlines, while a hung native
file reaches its one-second watchdog plus a small cleanup margin. The regression
fails on Round 0, requiring its eight-second safety guard and delaying the hung
file to 10.426 seconds. Timeout recovery and all fail-closed regressions remain;
the recovered slow cleanup fixture now stays within the existing deadline.
Round 1 verification is recorded in the report.

Round 1 verification: 89/89 focused tests and the complete eb1000 suite pass
(**0 failures in 1,486 s**), including all 322 client files and 79/79 serial
model tests. The new regression also passes under the full concurrent pool;
no safety guard fires and all fixture groups exit. LLP references and
`git diff --check` pass.
