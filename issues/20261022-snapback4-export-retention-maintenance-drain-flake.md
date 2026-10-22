# Snapback 4: export retention maintenance drain timed out in the diagnostic client pool

Status: Open
Date: 2026-10-22
Scope: `packages/snapback4/test/export-background.test.mjs`, case `retention cannot remove a run between directory creation and export lease acquisition`

Integration 23's initial diagnostic full client pool failed this unchanged case
at its `coalesced maintenance queue drained` assertion after 100.48 seconds.
The isolated case passed in 11.04 seconds without a source, assertion or deadline
change. The pool overlapped ongoing native builds during defect discovery;
that is an observed environment difference, not an established cause. The first
pool completed all 430 files and both full models, and left git status empty.
Its other two failures were separately reproduced and fixed in migration-guide
and residency-fixture setup. No passing qualification is inferred from that run.

The integration's qualification repeat pins an immutable native executable and
stable client assets. It must pass the entire pool again, not merely this case.
Investigate the retained maintenance evidence before changing cleanup/product
deadlines or ownership assertions. Passing repetitions do not establish cause.

Evidence is retained with the Integration 23 report (`client-pool-final.log`
and `export-retention-alone.log`); the original failure printed maintenance
snapshot `/tmp/sb4-maintenance-evidence/maintenance-dbc9651ae7b19554/snapshot-1792698987778791842-111e67a7-failure-drain-timeout`.
