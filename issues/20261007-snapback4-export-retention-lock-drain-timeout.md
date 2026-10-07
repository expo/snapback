# Snapback 4: raced export retention-lock deferrals can fail to drain

Status: Open
Date: 2026-10-07
Scope: Snapback 4 native export maintenance / background test
Related: LLP 3000.030 §15; [SIGKILL custody timeout](20261007-snapback4-export-background-sigkill-custody-timeout.md)

FH round 5's full Linux suite, merging `b14888f763` into `33321fe568` with the
Following fixes, failed `export-background.test.mjs:953`:

```text
repeated raced retention-lock deferrals stay pending and restore the bound after release
AssertionError: coalesced maintenance queue drained
maintenanceIdle .../export-background.test.mjs:571
TestContext .../export-background.test.mjs:977
```

The case intentionally drives four handled deferrals while holding the retention
lock, then releases it. Its 90-second drain predicate requires no outstanding
request/claimed/parked record and no live next/active maintenance process. The
case failed after 97.6 seconds including setup. The file's process-group cleanup
completed; it did not report a leak. The failed fixture's queue/process records
were not retained, so the cause is unclassified.

The exact case passed its first isolated rerun in 8.4 seconds. The 27 checked
export-test, wrapper, shim and witness source files are byte-identical to merged
main `b14888f763`. This is an unchanged-path failure observed during FH
qualification, not proof of its cause or of absence on main.

This is distinct from the linked SIGKILL test's timeout and from
`20261004-snapback4-native-witness-proc-group-inspection`: the native CLI suite
passed, and this failure emitted no `/proc` diagnostic. Do not collapse those
signatures or infer a process-ownership leak.

Evidence: [FH round-5 report](../snapback4/reports/20261006-fh-following-history/round-5/REPORT.md),
`export-failure.txt`, `export-source-control.json`, and the exact-case/whole-file
rerun logs and result receipts in that directory. The original full-suite
failure remains recorded even if a rerun passes.

Next: preserve the five maintenance records, maintenance log and verified owned
process state when this drain predicate first expires; determine whether the
request remained queued, its observer stopped, or processing failed. Retain the
fail-closed ownership checks and custody bound.


EM investigation, 2026-10-07: **still open; historical cause unclassified.**
The [retained report](../snapback4/reports/20261007-em-export-maintenance-drain/REPORT.md)
records 200 passing short invocations and eight passing complete-file runs,
additional focused/original-binary controls, then 32 passes per affected case
under four-core bursty CPU/disk load. The final instrumented complete file also
passes (58 passed, 36 platform skips). No ordinary lost-wakeup path was found;
passing repetitions do not resolve the original failure.

Drain failure now captures queue/lease/journal files, process/descriptor evidence
and maintenance step timestamps before fixture cleanup. Set
`SNAPBACK4_MAINTENANCE_EVIDENCE` to retain successful snapshots during a soak too.
The exact 90-second predicate rejects both a held-lease stall and pending work
whose fixture observer was killed; both snapshots are retained. No bound,
process-identity check, retry policy or product scheduling behavior changed.
Rebuilding a live Linux CLI contaminated early experiments with spawn ENOENT;
those failures are disclosed separately, and subsequent tests pin an immutable
binary. This does not establish the cause of the historical incident.
Next: use the retained diagnostics on recurrence, including the operator's macOS
soak, before assigning a cause or closing this ticket.
