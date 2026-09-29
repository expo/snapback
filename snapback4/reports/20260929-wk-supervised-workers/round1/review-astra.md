Reviewed `4fd338de5..c3efc87b0`. Five findings need fixes:

1. **High — Failed revocation leaves the old token usable.** [dev_worker.rs:256](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/dev_worker.rs:256), [dev_worker.rs:270](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/dev_worker.rs:270)
   `close_child_session` clears its expiry and family tracking even when deletion fails. I held SQLite’s writer lock past the timeout, killed a named worker, then released the lock. The replacement started, and the **old token still authenticated**.
   **Smallest fix:** retain failed revocations in supervisor-owned state and retry them; do not mint the replacement until its predecessor’s revocation commits.

2. **High — Deploy follows a symlink at the workers-directory root.** [worker_declarations.rs:43](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/worker_declarations.rs:43)
   The recursive copier rejects symlink entries but never checks `snapback/workers` itself. A project or dependency can make that directory a symlink to an external tree. My fixture deployed successfully and copied an external hidden `.env.test` file into the release. External worker entries also become executable declarations.
   **Smallest fix:** reject symlink roots before discovery and packaging, and preserve the no-follow check throughout traversal.

3. **Medium — Workers and their descendants can outlive the server.** [dev_worker.rs:238](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/dev_worker.rs:238), [dev_worker.rs:278](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/dev_worker.rs:278)
   Cleanup depends on Rust destructors and signals only the immediate child. I reproduced both a worker surviving server `SIGKILL` and a worker’s helper surviving ordinary server `SIGTERM`. Survivors can retain ports, ledger locks, and ongoing provider calls. This inherited cleanup mechanism does not fulfill the expanded supervision claim.
   **Smallest fix:** bind child lifetime to parent death and supervise a process group per worker, terminating descendants on worker exit and shutdown.

4. **High — Fresh backends silently suppress unrelated effects using the persistent ledger.** [dev_worker.rs:236](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/crates/snapback4/src/dev_worker.rs:236)
   `dev --fresh` uses temporary engine storage, but the injected ledger path still comes from the project’s persistent store path. Effect IDs use sequence and ordinal, so fresh stores reuse them. Two successive fresh-server runs each emitted their first effect: both settled as `sent`, but the handler ran **only once**. The second received the first backend’s cached receipt.
   **Smallest fix:** derive the ledger location from the actual opened store, including temporary storage, and scope completions to the store identity.

5. **Medium — Broken ledger initialization consumes delivery attempts without performing work.** [worker.ts:143](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/packages/snapback4/src/worker.ts:143), [worker.ts:189](/home/ccheever/sb4-intent/review-wk-r0-astra/snapback4/packages/snapback4/src/worker.ts:189)
   Polling starts before ledger initialization succeeds. A rejected initialization promise remains cached; each claimed effect becomes a retryable handler failure. With a corrupt file, my probe recorded three failed settlements and zero handler calls. Finite retry policies can exhaust otherwise valid work.
   **Smallest fix:** initialize and validate storage before claiming; report ledger failures and suspend polling instead of treating them as application-handler failures.

What is sound: the existing effect ID remains stable across redelivery; successful ledger completions commit before settlement; failed handlers roll back; concurrent processes serialize through SQLite. The provider-call/commit ambiguity is documented accurately. Initial-token redaction handles split chunks, child environments are explicitly constructed, and doctor status records contain no token.

All five new tests passed on a disposable copy. The probes above exposed gaps they miss. One surviving mutation would be deleting the named-family session deletion at `dev_worker.rs:261`: the new tests check restart counts but never retry the retired bearer.

The worktree is unchanged. I did not open `provider-secrets.env`.

**Verdict: NOT READY.**
