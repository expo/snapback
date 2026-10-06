# Snapback 4: process inspection times out on large process tables

**Opened:** 2026-10-06
**Closed:** 2026-10-06
**Status:** Closed — bounded timeout recovery and inspection-aware wait accounting
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
signaling remain intact. Synchronous inspection is excluded from the shared
file watchdog and cleanup wait clock, so it cannot itself consume their
progress/EOF-delivery budget. Two fresh empty group inspections remain required.

All 89 focused regressions pass, including real delayed-command recovery in
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
