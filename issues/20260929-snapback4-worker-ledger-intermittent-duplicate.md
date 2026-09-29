# Snapback 4: investigate an intermittent duplicate in the shared-ledger witness

Status: Open
Date: 2026-09-29
Scope: `snapback4/packages/snapback4/test/supervised-workers.test.mjs`

During WK round 3's initial affected run, `two standalone processes sharing a
ledger perform one action, then replay after both exit` failed: the `actions`
file contained two `performed` lines instead of one. The worker/ledger
implementation and this test are unchanged from round-2 commit `13a00b80b`.
The fixture does not use either Rust path changed by round 3 (HTTP refresh or
private snapshots). This is inherited lane behavior, not an established
round-3 regression or an established environmental failure.

One isolated rerun, all 20 subsequent isolated trials, and the final four-file
99-test affected run passed without a source repair. The original test suppresses
`onError`, so the initial evidence cannot establish whether a storage failure
occurred between the provider call and completion commit. No root cause or
fix is claimed. Do not weaken its assertion or turn the failure into a pass.

Next: retain per-process handler/commit/error observations when reproducing,
including whether SQLite writer/commit contention caused an uncommitted
provider action. Preserve the documented provider-call/commit ambiguity while
checking the claim that successful committed receipts serialize across processes.

Evidence: [round-3 failure ledger](../snapback4/reports/20260929-wk-supervised-workers/round3/FAILURES.md),
`affected.log.gz`, `ledger-contention-rerun.log.gz`,
`ledger-contention-repeat.log.gz`, and `affected-final.log.gz` in that report directory.
