# Snapback2 install witness loses child exit during timeout cleanup

Status: Open
Date: 2026-09-07
Scope: Clique release measurement helper, not a confirmed package-install defect

The 0.0.17 default npm11 install witness exceeded its original 30-second wait. Its cleanup then required a current matching process identity, which was unavailable, and raised before waiting/reaping and writing the install terminal. The helper exited 1; the npm exit remains unknown and ci was never run. Later exact PID/group observations found no owned process. The npm success-looking log does not establish the missing exit code. [Original evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/cli-017-public-installed/README.md).

Repair a separate helper derivative so an exit during timeout identity inspection can be waited and recorded. Keep the timeout classified as failed even if actual return code is 0. Continue to signal only a live matching owned process group; a changed identity must never be signaled. Preserve incomplete receipts if ownership cannot be reconciled. Do not change the 30-second limit, overwrite the original helper/results, or repeat the original install to make this observation pass.

An Astra xhigh preparation is assigned in the external `default-install-timeout-race-repair-r1` lane. Controlled regressions must cover exit during timeout cleanup, a still-live matching child, and changed-identity/no-signal behavior. No npm/network operation is needed for those controls. The cause of the original slow install remains unestablished; this ticket fixes measurement reliability rather than declaring that slowdown solved.

2026-09-07 verification update: all six controlled r2 tests passed, including exact-parent reproduction, exit during cleanup, matching-group reaping, changed-identity refusal/unknown receipt, disappearance before group lookup, and ordinary success. The first harness attempt failed on Python 3.9 kqueue context-manager support; its failure and the narrow correction are retained in [the evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/timeout-reaping-controls/README.md). Independent review and adoption into future measurement packets remain pending. The original npm timeout remains failed/incomplete.
