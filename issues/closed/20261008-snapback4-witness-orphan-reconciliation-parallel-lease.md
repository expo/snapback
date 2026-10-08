# Snapback 4: orphan reconciliation retains fork-inherited leases in parallel tests

Status: Closed — 2026-10-08, FS
Date: 2026-10-08
Scope: `verbs::witness::publication::tests::witness_orphan_reconciliation_requires_all_leases_and_preserves_changed_identity`

DK saw `E_WITNESS_ARTIFACT: retention lock busy` once in a four-thread CLI unit run on 2026-10-07; the isolated rerun passed. No existing ticket was found at the FS base `ecba83f39e2f8539ffa08d73949e8e953760f3e7`.

FS reproduces four failures in 30 loaded witness-module runs with four test threads and concurrent neighbouring forks. Some runs conservatively preserve the orphan instead of reaching the following removal/changed-identity assertion. The neighbouring repeated-SIGKILL orphan test fails nine times and two-wrapper publication once with the same custody lifetime problem. All roots are distinct; there is no shared fixed path between these cases.

A deliberately pipe-gated fork proves that a close-on-exec retention descriptor still refuses cleanup after its parent handle drops. Run/export/destination lease holders likewise preserve the orphan until the fork exits and is reaped. An explicit unlock would violate shared custody. Keep product locking unchanged and isolate last-close tests from unrelated libtest forks.

Evidence and final disposition: [FS report](../../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md).

## FS resolution — 2026-10-08

The named orphan-reconciliation case passes all 30 final loaded witness runs and five final whole-unit runs. Its scenario is isolated from unrelated libtest forks; pipe-gated inherited holders prove retention refusal and run/export/destination deferral before being reaped. The original changed-inode refusal, later intent preservation, old target bytes and successful reconciliation assertions remain. Keeping the retention fork alive through the positive cleanup assertion fails with the exact retention-lock-busy code. The repeated-kill orphan-marker neighbour also passes 30/30 after isolation. The separate intentional two-wrapper recovery/publisher contention is tracked in 20261008-snapback4-two-wrapper-recovery-contention.md and is not closed here.

[Full commands, baseline/final logs, controls and limits](../../snapback4/reports/20261008-fs-witness-worker-flakes/REPORT.md).
