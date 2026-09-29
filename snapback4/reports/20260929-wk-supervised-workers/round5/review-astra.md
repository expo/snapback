Reviewed `git diff 78bcc92c8..74757c866b`. **The ledger repair is sound. One Medium supervision defect remains.**

On disposable copies, **114/114 affected tests passed**, plus the production-mode rotation test and additional dev/serve SIGINT checks. I used copied lane-built binaries after verifying their Rust sources matched this review tree.

| Earlier finding | Detecting checks passed |
|---|---|
| Retirement on removal, restart and rotation | Locked deletion; immediate bearer refusal; eventual family deletion; rotation independent of expiry; serve peer renewal |
| Credential exposure and refresh | Split-write redaction; named/conventional refresh refusal; manual-seat refresh; secret subsets; dev/serve environments excluding `NODE_OPTIONS` |
| Unvalidated source execution | Schema/root/entry/helper symlinks and FIFOs; rejected-source restart; entry/helper replacement after validation; checked project imports |
| Process cleanup | Worker death; host TERM/KILL; watchdog KILL/TERM/INT/HUP; simultaneous shutdown grace; additional host SIGINT checks |
| Admission and backoff | Increasing failure backoff; admission resumes after repairing Node without another edit |
| Ledger initialization and identity | Corrupt database/schema/receipt/path refusal before claims; fresh/replaced-store separation; dev/serve `ledger-unavailable` status |
| Serve dependency lookup | Schema-local packages resolve, including precedence over project packages |
| Durability and cancellation guards | FULL-setting deletion and handler-waiter abort-check deletion both fail their regression tests |
| Busy-commit duplicate | Fixed implementation passes; round-3 implementation deterministically performs twice |

**Medium — Immediate host restart launches overlapping workers.**
[snapback4/crates/snapback4/src/dev_worker.rs:333](/home/ccheever/sb4-intent/review-wk-r4-astra/snapback4/crates/snapback4/src/dev_worker.rs:333), interacting with the watchdog grace period at [worker_process.rs:59](/home/ccheever/sb4-intent/review-wk-r4-astra/snapback4/crates/snapback4/src/worker_process.rs:59).

**Reproduced in both dev and serve:** start a worker that keeps running during SIGTERM cleanup, SIGKILL the host, then immediately restart the same backend. The new host starts its replacement while the original Node process remains alive. The original watchdog eventually kills it after its two-second grace period.

Both probes recorded:

```text
replacement started while old worker alive: true
old bearer against replacement host:       401
```

Credential retirement works, but process lifetime is not coordinated across host instances. The old process can retain a port, ledger lock or ongoing provider call while its replacement starts. Existing shutdown tests wait for cleanup; they miss immediate restart.

**Smallest fix:** retain the store ownership lock in watchdogs until group cleanup completes, exclude that descriptor from Node, and gate replacement-host startup on its release. Add the immediate-restart test for both verbs. The [detecting probe](/tmp/wk-r4-astra-review-fw33xig5/snapback4/packages/snapback4/test/review-extra.test.mjs:69) is retained.

The ledger’s busy-commit fix at [worker-ledger.ts:75](/home/ccheever/sb4-intent/review-wk-r4-astra/snapback4/packages/snapback4/src/worker-ledger.ts:75) is correct. `BEGIN IMMEDIATE` reserves the writer but permits readers. In rollback-journal mode, a reader can prevent COMMIT’s exclusive lock; SQLite leaves that transaction active and permits retrying COMMIT. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html), [locking protocol](https://www.sqlite.org/lockingv3.html).

The deterministic two-process control demonstrated:

- **Before:** A performs; its COMMIT returns `SQLITE_BUSY`; A rolls back; B finds no receipt and performs again.
- **After:** A retains its transaction, retries only COMMIT, then B reads A’s receipt. One action, identical receipts, successful replay after both processes exit.
- Cancellation after provider success preserves the same result.

Busy acquisition occurs before handler execution. Checkpointing is not involved in this rollback-journal reproduction. Claim redelivery supplies another attempt; the old rollback discarded the protection against repeating it. Process death or unrecoverable storage/encoding failure before durable completion remains the documented ambiguity. The original intermittent run lacks evidence proving this exact cause, but the reproduced mechanism is fixed.

**Low — Initialization cancellation still lacks detecting coverage.**
[snapback4/packages/snapback4/src/worker-ledger.ts:17](/home/ccheever/sb4-intent/review-wk-r4-astra/snapback4/packages/snapback4/src/worker-ledger.ts:17).

Deleting the **open-loop** `signal.throwIfAborted()` leaves all **53 regression/contention tests green**. A separate control detects it: hold a writer lock, start `WorkerLedger.open`, abort, then release the lock. Current code rejects with `AbortError`; the mutant opens successfully after cancellation.

**Smallest fix:** add that control alongside the existing handler-waiter abort test. The production guard itself is correct.

No credential leak was found. Retirement custody, refresh ownership, explicit environments, source snapshots and committed-receipt replay withstand the tested failures. The previously ticketed Low process-group-ID reuse risk at [dev_worker.rs:412](/home/ccheever/sb4-intent/review-wk-r4-astra/snapback4/crates/snapback4/src/dev_worker.rs:412) remains acknowledged and unfixed; current tests do not force ID reuse.

The worktree is unchanged. No commit was made, and no `provider-secrets.env` was opened.

**Verdict: NOT READY.**
