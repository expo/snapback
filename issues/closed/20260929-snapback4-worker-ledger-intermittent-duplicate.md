# Snapback 4: investigate an intermittent duplicate in the shared-ledger witness

Status: Resolved
Resolved: 2026-09-29 (WK round 4)
Date: 2026-09-29
Scope: `snapback4/packages/snapback4/test/supervised-workers.test.mjs`

## Initial investigation — round 3

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

Evidence: [round-3 failure ledger](../../snapback4/reports/20260929-wk-supervised-workers/round3/FAILURES.md),
`affected.log.gz`, `ledger-contention-rerun.log.gz`,
`ledger-contention-repeat.log.gz`, and `affected-final.log.gz` in that report directory.


## Resolution — 2026-09-29

Both independent round-3 reviewers identified a reproducible mechanism:
rollback-journal COMMIT needs an exclusive lock. A reader can return SQLITE_BUSY
while leaving the completed transaction intact. The old ledger rolled it back,
so another process performed the same provider action. The original intermittent
run suppressed errors; it cannot prove this was that particular run's cause.
The deterministic round-4 control now observes the exact mechanism.

The ledger retains its transaction and asynchronously retries only COMMIT on
SQLITE_BUSY. The completed handler never runs again as part of that retry, even
if cancellation arrives while committing. Cancellation still stops a waiter
before it can acquire the writer reservation or run a handler.

`worker-ledger-contention.test.mjs` initializes two real processes, holds a third
connection's deferred read after process A's provider call, observes A's actual
busy COMMIT, and starts process B before releasing the read. Previous code
performs twice; repaired code returns the original receipt to both processes,
performs once, and replays that receipt after both processes exit. Both ordinary
and post-provider cancellation variants pass. The original shared-ledger test
keeps every assertion and now reports unexpected worker errors.

This resolves the recoverable-contention defect. A process death or unrecoverable
storage/result-encoding failure after provider success and before durable commit
still requires provider idempotency; no exactly-once external call is promised.
Long-lived readers and providers can delay everyone sharing this ledger.

Evidence: [round-4 report](../../snapback4/reports/20260929-wk-supervised-workers/round4/REPORT.md),
`commit-before-final.log.gz`, `commit-fixed.log.gz`, and `affected.log.gz`.
