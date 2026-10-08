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
passes (58 passed, 36 platform skips). Grok subsequently identified an untested
wakeup candidate; passing repetitions do not resolve the original failure.

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


EM round 2: the [diagnostic hardening report](../snapback4/reports/20261007-em-export-maintenance-drain/round2/REPORT.md)
records bounded/private capture, birth/command/group admission and asynchronous
trace I/O that cannot block a custodian on a FIFO. These fix the instrumentation,
not the historical queue failure. The 90-second predicate remains unchanged.
Grok identified a pre-existing candidate: `kick_until`'s second `!runnable` check
can return success while its next lease is still held, allowing a newly committed
request to coalesce against an exiting holder. A guard unwind can similarly
follow a fresh producer's coalescing attempt (guard cancellation/expiry itself
is a documented stop). Neither candidate was reproduced or attributed to this
incident. Keep both in the next regression/audit; no queue fix is included here.


EM round 3, 2026-10-07: **still open pending macOS soak.** The
[round-3 report](../snapback4/reports/20261007-em-export-maintenance-drain/round3/REPORT.md)
now demonstrates both wakeup defects deterministically. A scratch binary with
the exit fixes removed reaches each forced coalescing window, leaves the request
pending with no observer, and fails the unchanged 90-second drain check. The
fixed binary drains both. These are demonstrated product defects consistent
with the symptom, but the missing historical snapshots still prevent attribution
to this incident.

An empty second runnable check releases the pending lease and rechecks in a loop.
A fresh producer that sees a busy lease records a bounded wakeup and retries the
lease before coalescing; a stopped observer releases custody before handing off
an unobserved wakeup using that producer's absolute deadline. Successful guards
consume the wakeup before observing work. No fresh producer means cancellation,
sleep and expiry remain stops. Automatic peer chains cannot renew their budget.
Debug barriers are inert in release. The original drain predicate/90-second
guard and round-2 diagnostic safety fixes remain unchanged; lane FL's shared
process-identity checks are untouched. Retained evidence and validation counts
are in the report. No push or publication occurred.

A loaded EM round-3 repetition also produced this drain assertion with a
**parked cleanup error**, `E_WITNESS_PROCESS: invalid /proc process group`.
The retained result/trace shows native work finished after 142 ms, cleanup
refused, and the claim parked before the observer exited. This recurrence is
linked to the existing [native inspection ticket](20261004-snapback4-native-witness-proc-group-inspection.md).
It is retained as a failure, not a successful soak or proof of either wakeup
race in the historical runs. Native ownership checks and the refusal to treat
parked maintenance as drained remain intact.
