# Snapback 4: intermittent export retention successor and removal readiness assertions

Status: Open
Date: 2026-10-22
Scope: snapback4/packages/snapback4/test/export-background.test.mjs
Related: issues/20261016-snapback4-unit-cleanup-and-resolver-readiness-flakes.md

Integration22's first full Linux client pool failed two unchanged cases:

- `blocked retention has bounded custody: before deadline`: the successor
  `f.invoke('new publication')` exited1 instead of0 after the retention deadline.
- `failed export removal cannot race a maintenance writer (observer)`: the
  `marker-ready.json` readiness observation did not arrive within30 seconds.

The file is byte-identical to the0.4.37 base bfe435467c. Both cases passed
alone on the merged candidate (2 passed,0 failed,33.3 seconds), with all state,
lease, drain and actual product-deadline assertions intact. No timeout or
assertion was changed. Other product/client and Rust tests were running during
that initial pool; this is an observation, not a proven cause. A concurrent
client artifact rebuild also occurred earlier in that pool, so it is not
claimed as stable release qualification. The final complete repeat must pass.

The observer failure retained its existing maintenance snapshot under
`/tmp/sb4-maintenance-evidence/maintenance-dbc9651ae7b19554/`.
Integration22's compact evidence records the initial pool, isolated rerun and
complete-repeat outcome under snapback4/reports/integration22. A passing
repeat does not establish the cause or close this ticket. Preserve the
successor-publication and removal-custody assertions when investigating.
