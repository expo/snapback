Reviewed `git diff b7d05baff..ba2dcd0cb`. **One High finding blocks landing: ordinary SQLite contention can discard a successful provider action and cause another worker to repeat it.**

I tested disposable copies on Linux/Node 24, using the lane’s same-commit binary and freshly compiled TypeScript. All 102 affected tests passed across runs; one initially required copying a missing chat fixture. An additional host-SIGINT cleanup test passed.

| Earlier finding | Detecting coverage passed |
|---|---|
| Forgotten retirement on restart, rotation or removal | Locked-writer restart; rotation with expiry extended; removal with immediate query/mutation/refresh refusal and eventual family deletion |
| Credential exposure and refresh | Split-write stdout/stderr redaction; named and conventional refresh refusal; manual seats remain refreshable; standalone error redaction; explicit environments and secret subsets |
| Unvalidated source execution | Schema/root/entry/helper symlinks and FIFO refusal; rejected-source restart; entry/helper replacement after validation; conventional-entry snapshots |
| Snapshot dependency resolution | Schema-local packages resolve correctly, including precedence over project-root versions |
| Orphaned processes and sequential shutdown | Worker death, host TERM/KILL, watchdog KILL/TERM/INT/HUP, shared shutdown grace, plus my host-SIGINT control |
| Admission and restart backoff | Increasing secret-failure backoff; newly declared worker starts after repairing Node without another source edit |
| Ledger identity, initialization and durability | Fresh/replacement-store separation; corrupt database/schema/receipt/parent-path refusal before claims; FULL synchronization; open/run contention; disk-full and failed commit/rollback |

The report explicitly retains the earlier Low process-group-ID reuse risk; the existing watchdog test keeps the leader alive and does not detect reuse. Doctor’s historical status and initialization-failure suspension also remain documented behavior.

**High — Recoverable commit contention causes duplicate provider actions.**  
[snapback4/packages/snapback4/src/worker-ledger.ts:62](/home/ccheever/sb4-intent/review-wk-r3-astra/snapback4/packages/snapback4/src/worker-ledger.ts:62), with unconditional rollback at [line 65](/home/ccheever/sb4-intent/review-wk-r3-astra/snapback4/packages/snapback4/src/worker-ledger.ts:65).

The ledger uses rollback journaling and `busy_timeout = 0`. `BEGIN IMMEDIATE` excludes competing writers but permits readers. Committing requires an exclusive lock; a reader can therefore make `COMMIT` return `SQLITE_BUSY`. SQLite leaves that transaction active and permits retrying its commit. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html), [locking protocol](https://www.sqlite.org/lockingv3.html).

I reproduced this deterministically with **two actual worker processes**, pausing the second at its successful SQLite shared-lock acquisition during initialization:

```text
A: performs provider action
B: acquires SHARED lock during initialization; paused
A: COMMIT → SQLITE_BUSY (5)
A: ROLLBACK → success; reports ledger unavailable; exits
B: resumes; finds no completion; performs the same action; commits
```

Both processes exited successfully; the action log contained two entries. No process crash, disk failure or simultaneous writers were needed. The fixture’s empty `onError` hides A’s storage error.

This reproduces the ticket’s symptom through a concrete mechanism. The original run suppressed the observations needed to prove it had this exact cause. Checkpointing is irrelevant here: the reproduced ledger uses `journal_mode=delete`. The claim protocol supplies redelivery; the ledger’s rollback permits the second execution.

The duplicate falls temporally inside the documented provider-before-commit window. **Its trigger is nevertheless an avoidable implementation defect:** recoverable contention makes the code discard an intact transaction and its successful result. It should not be dismissed as unavoidable crash ambiguity.

**Smallest fix:** change the handler transaction at [line 46](/home/ccheever/sb4-intent/review-wk-r3-astra/snapback4/packages/snapback4/src/worker-ledger.ts:46) to `BEGIN EXCLUSIVE`, retaining the existing asynchronous busy-retry loop. This moves reader contention before provider execution. Alternatively, retain the transaction and asynchronously retry busy commits; never rerun the handler as that retry.

**Deterministic regression:** initialize two ledger connections, hold `BEGIN; SELECT … FROM completions` on a third connection, start the first handler, then release the reader. Require successful completion, replay of the same receipt through the second ledger, and exactly one handler call. Current code fails with two calls. The one-line `BEGIN EXCLUSIVE` change passed this control in a disposable copy. The [two-process reproducer](/tmp/wk-r3-review-9jwqpn7q/ledger-lock-race.mjs) is also retained.

What is sound: credential retirement and refresh ownership now withstand the tested failures; source snapshots preserve validated entry/helper bytes; dev and serve share supervision. Committed receipts replay correctly, failed handlers do not become completions, store identities separate ledgers, and effect IDs remain stable.

**Confirmed surviving mutation:** deleting `signal.throwIfAborted()` at [worker-ledger.ts:45](/home/ccheever/sb4-intent/review-wk-r3-astra/snapback4/packages/snapback4/src/worker-ledger.ts:45) leaves all **102 tests green**. A separate control—hold the writer lock, start a waiter, abort it, then release the lock—detects the mutation: it executes a handler after cancellation.

The worktree is unchanged. No commit was made, and no `provider-secrets.env` was opened.

**Verdict: NOT READY.**