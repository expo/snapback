# Snapback 4 export maintenance queue did not drain after publication-handoff crash

Status: Open
Date: 2026-10-06
Scope: Snapback 4 Expo export maintenance / crash recovery tests
Related: LLP 3000.030 §15

RO Round 3's complete suite, with SDK implementation `63d6cf1400`, failed:

```text
export-background.test.mjs
maintenance crash matrix: publication-handoff (off, next Expo fails)
AssertionError: coalesced maintenance queue drained
maintenanceIdle:571; test:1022
```

The test killed the publisher after verified publication and before maintenance
handoff, then ran an export whose Expo fixture exits 23. Its 90-second
maintenance-idle guard expired; the subtest finished after 98.25 seconds.
The other crash-matrix cases completed. The full client pool reported 6,525
passes, three failures and 47 labelled skips; the other two failures were the
RO await census and the pre-fix replacement-account logout expectation.

Export maintenance code and this test are unchanged from Round 2 head
`929086afde`. The failed fixture's cleanup ran before investigation, so no
maintenance queue/process snapshot was retained. The cause is unknown; this
record does not establish a leaked process or attribute the failure to load.
Do not weaken the drain check based on this failure alone.

The entire export-background file is being rerun unchanged. Results will be
appended below. Evidence is in the
[RO Round 3 report](../snapback4/reports/20261006-ro-read-only/REPORT.md):
`evidence/round3-full-suite.log.gz` and `evidence/round3-export-rerun.log.gz`.

Next: retain queue records, maintenance log and owned-process liveness before
fixture cleanup on the next occurrence, then establish which queued transition
failed to settle. A passing rerun does not erase the full-suite failure.

Unchanged entire-file rerun: **58 passed, 36 platform skips, zero failures**
in 320 seconds. The failed crash case passed. The original failure remains
unexplained; keep this ticket open for snapshot capture on recurrence.


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
