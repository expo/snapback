Reviewed `f9620c815bc2e89ce7b36576926f31e22250e029..ce50badf6`. **Three findings still block landing.**

All 62 checked-in worker tests passed on disposable copies. The original reproductions now pass:

| Round 0 finding | Detecting test |
|---|---|
| Failed revocation during restart | Hold SQLite’s writer lock, kill worker, release lock; retired bearer returns 401. Rotation also tested independently of expiry. |
| Symlinked workers root | Deploy rejects schema, root, entry and helper symlinks, plus FIFOs. |
| Fresh-store completion collisions | Two fresh stores and two persistent-store incarnations reuse an effect ID but each executes its handler. |
| Workers/descendants outlive host | Worker death, host SIGTERM and host SIGKILL terminate descendants. My additional SIGINT control also passed. |
| Broken ledger initialization consumes attempts | Corrupt database, incompatible schema, corrupt receipt and invalid parent path produce zero claims or settlements. |

Grok’s secret-subset, increasing-backoff, simultaneous-shutdown, SQLite contention, disk-full and failed-commit/rollback regressions also passed. Shared-ledger serialization remains an explicitly documented tradeoff.

1. **High — Removing a worker still forgets failed revocation.**
   [`snapback4/crates/snapback4/src/dev_worker.rs:78`](/home/ccheever/sb4-intent/review-wk-r1-astra/snapback4/crates/snapback4/src/dev_worker.rs:78), with the ignored retirement result at [line 334](/home/ccheever/sb4-intent/review-wk-r1-astra/snapback4/crates/snapback4/src/dev_worker.rs:334).

   `named.retain` drops removed workers. Although `close_child_session` now preserves state on failure, that state disappears when `Drop` returns.

   **Reproduced:** remove a declaration, acquire SQLite’s writer lock during its shutdown grace period, wait for retirement to fail, then release the lock. The session remained stored, and the retired bearer successfully queried `/q/who` as `service:push` with **HTTP 200**. Effect claims returned 401 because their revision fence works; ordinary query authentication does not apply that fence.

   **Smallest fix:** keep removed workers’ pending retirements under supervisor ownership and retry until deletion commits. Do not discard their family state or report successful retirement on failure.

2. **High — Restart executes a symlink that discovery rejected.**
   [`snapback4/crates/snapback4/src/dev_worker.rs:266`](/home/ccheever/sb4-intent/review-wk-r1-astra/snapback4/crates/snapback4/src/dev_worker.rs:266).

   Discovery checks opened descriptors but retains a pathname. Subsequent launches reopen that cached pathname without repeating declaration validation.

   **Reproduced:** start a regular `push.mjs`, replace it with a symlink outside the workers subtree, wait for the watcher to reject adoption, then kill the worker. Its replacement executed the external module with a newly injected service token; that module authenticated to `/effects/claim` with **HTTP 200**. Thus even an explicitly rejected source change becomes executable on restart.

   **Smallest fix:** refuse every launch/restart when declaration validation fails. Preserve validated source custody through execution—such as a private snapshot—so pathname replacement cannot bypass the check.

3. **Medium — Watchdog death leaves its worker running alongside the replacement.**
   [`snapback4/crates/snapback4/src/dev_worker.rs:212`](/home/ccheever/sb4-intent/review-wk-r1-astra/snapback4/crates/snapback4/src/dev_worker.rs:212).

   `self.child` represents the watchdog. When it exits, the supervisor clears both process handles without terminating the Node process group. The watchdog cannot perform its cleanup after SIGKILL or an OOM kill.

   **Reproduced:** kill the recorded watchdog PID. A replacement started while the original Node worker remained alive. The survivor can retain a provider call, port or ledger lock despite credential retirement.

   **Smallest fix:** retain and terminate the owned Node process group when its watchdog exits unexpectedly, before clearing `worker_pid` or starting a replacement.

What is sound: initial-token redaction handles split chunks on the supervised streams; child environments and declared-secret subsets are explicit; doctor’s status records contain no token. Effect IDs remain stable across redelivery. Successful ledger receipts commit before settlement, failed handlers roll back, and concurrent processes replay the winning receipt. The provider-call/ledger-commit ambiguity is documented accurately.

**Confirmed surviving mutation:** changing `PRAGMA synchronous = FULL` to `OFF` at [`worker-ledger.ts:30`](/home/ccheever/sb4-intent/review-wk-r1-astra/snapback4/packages/snapback4/src/worker-ledger.ts:30) leaves all 27 supervision/ledger regression tests green. Their durability coverage does not detect disabled synchronization.

The worktree is unchanged; no commit was made. I did not open any `provider-secrets.env`.

**Verdict: NOT READY.**
