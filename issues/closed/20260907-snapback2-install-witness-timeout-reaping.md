# Snapback2 install witness loses child exit during timeout cleanup

Status: Closed — corrected helper retained; obsolete packet requirement retired
Date: 2026-09-07
Scope: Clique release measurement helper, not a confirmed package-install defect

The 0.0.17 default npm11 install witness exceeded its original 30-second wait. Its cleanup then required a current matching process identity, which was unavailable, and raised before waiting/reaping and writing the install terminal. The helper exited 1; the npm exit remains unknown and ci was never run. Later exact PID/group observations found no owned process. The npm success-looking log does not establish the missing exit code. [Original evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/cli-017-public-installed/README.md).

Repair a separate helper derivative so an exit during timeout identity inspection can be waited and recorded. Keep the timeout classified as failed even if actual return code is 0. Continue to signal only a live matching owned process group; a changed identity must never be signaled. Preserve incomplete receipts if ownership cannot be reconciled. Do not change the 30-second limit, overwrite the original helper/results, or repeat the original install to make this observation pass.

An Astra xhigh preparation is assigned in the external `default-install-timeout-race-repair-r1` lane. Controlled regressions must cover exit during timeout cleanup, a still-live matching child, and changed-identity/no-signal behavior. No npm/network operation is needed for those controls. The cause of the original slow install remains unestablished; this ticket fixes measurement reliability rather than declaring that slowdown solved.

2026-09-07 verification update: all six controlled r2 tests passed, including exact-parent reproduction, exit during cleanup, matching-group reaping, changed-identity refusal/unknown receipt, disappearance before group lookup, and ordinary success. The first harness attempt failed on Python 3.9 kqueue context-manager support; its failure and the narrow correction are retained in [the evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/timeout-reaping-controls/README.md). Independent review and adoption into future measurement packets remain pending. The original npm timeout remains failed/incomplete.

2026-09-07 correction review: R3 removes the unsupported `logComplete` inference identified by the first pair. All six controls passed once; fresh independent Astra xhigh and Grok4.6 xhigh reviews returned READY after actual closed runs. [Accepted derivative](../benchmarks/runs/2026-09-06-clique-improvement/evidence/timeout-reaping-controls/r3/README.md). Root requires this exact helper base for the later018 public default-install witness. This ticket remains open only for its bound future packet adoption; the source correction and controlled review are complete. No original017 retry or latency claim is authorized by this evidence.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — evidence-tool adoption only. **Triage priority:** P3.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The R3 helper correction and six controls are already complete. No new timeout fix or retry of the original failed install is owed. The retained README still distinguishes the 0.0.18 dry producer from the future public default-install packet.

benchmarks/runs/2026-09-06-clique-improvement/evidence/timeout-reaping-controls/r3/README.md binds candidate-helper.py SHA b66c1e0e7eddb99d6a17a3902a0d3fb116f35618c47068d16b8d97a87438fa0a. Remaining: name a later default-install packet using that exact derivative and its terminal record, or explicitly retire the unused packet requirement. Original 0.0.17 exit remains unknown.

## Resolution — 2026-09-11

The user delegated the remaining queue decisions. The unused 0.0.18 packet
requirement is retired: current release qualification has moved beyond that
packet, while R3 and all six deterministic timeout/reaping controls remain the
accepted helper evidence. This does not reinterpret or repair the original
0.0.17 record; its npm exit remains unknown and that witness remains failed.
