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
