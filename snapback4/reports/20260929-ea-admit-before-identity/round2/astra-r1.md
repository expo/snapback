Three findings remain. I reviewed the requested diff and ran tests only on a copy; the worktree is unchanged.

The **32/32 admission tests pass**, including detecting tests for all four round-0 scenarios: overlapping native CAS reads, online expiry after peer execution, exact operation/arguments/viewer conflicts, and staged replacement binding on wasm and Worker. The **319/319 delivery matrix also passes**. I did not rerun all 10,000 session sequences.

1. **High — native cached emptiness bypasses store binding and FIFO.** [native-admission.ts:42](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/packages/snapback4/src/native-admission.ts:42), with unchecked deferred binding at [device.rs:1037](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/crates/snapback4-device/src/device.rs:1037).

   Owner A begins pre-identity admission and pauses. Owner B identifies its store and caches `identified && empty`. A then commits deferred custody, but B continues bypassing the shared admission plans.

   Reproduced through two public local clients and real servers: A’s write was bound to the original store; B retried the same ID and input after identifying a replacement. Ordinary admission copied the deferred entry without validating its captured identity, and **the replacement executed it**. A separate same-store test submitted different IDs and observed server POST order **SECOND, FIRST**.

   **Smallest fix:** remove the process-local empty-queue shortcut for custody-sensitive operations. Ordinary native admission must atomically honor current deferred binding, status and order; checking only identical input is insufficient.

2. **High — native expiry still reports an executed write as unsent.** [identity-admission.ts:107](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/packages/snapback4/src/identity-admission.ts:107).

   A pauses its deferred admission before saving metadata. B identifies, ordinarily admits the same ID/input, executes it and persists success. A subsequently saves an unadmitted deferred record. Its deadline expires before A identifies.

   Reproduced with two public clients and a real server: B returned `sent`; A emitted **`E_ADMISSION_TIMEOUT`**, explicitly saying “was not sent” and recommending a new attempt. Meanwhile, A’s `write(id)` correctly returned the durable `sent` receipt. The expiry branch checks neither existing outbox custody nor terminal history before declaring failure. Following its advice can duplicate the effect under a new ID.

   **Smallest fix:** adjudicate native expiry atomically against deferred metadata, ordinary outbox custody and terminal receipts. Recover the existing outcome or preserve potentially dispatched custody, and emit the adjudicated outcome.

3. **Medium — a restore strands and hides deferred writes.** [local.ts:1056](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/packages/snapback4/src/local.ts:1056), with visibility suppressed at [local.ts:1270](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/packages/snapback4/src/local.ts:1270).

   A fresh replica stages snapshot head 10 without publishing its identity, then accepts a mutation. The next response proves that the same store has restored to head 0. `E_STORE_RESTORE` stops flushing before deferred refusals can settle.

   Reproduced using the production wasm client and device: after restore and advancing beyond the deadline, **`write(id)` remained pending, `pendingWrites()` returned an empty list, and `onWrite` emitted nothing**. No POST occurred.

   **Smallest fix:** allow proven-unsent deferred refusals to settle behind the restore fence while keeping transport disabled. Preserve their pending visibility until terminal custody commits.

The ordinary single-owner path is sound in the tested cases: custody survives reload/navigation, IDs and order persist, prediction waits for admission, and pending writes settle visibly. I found no additional prediction-eligibility or server-authorization bypass. The public refusal documentation is actionable, but finding 2 violates its “unsent” guarantee.

Test strength remains insufficient at the handoff boundaries. On a copy, I deleted the pre-admission identity-freeze save at [identity-admission.ts:119](/home/ccheever/sb4-intent/review-ea-r1-astra/snapback4/packages/snapback4/src/identity-admission.ts:119); **all 32 admission/race tests still passed**. Add a peer-expiry schedule paused between that save and native admission, alongside the reproduced scenarios above.

**Verdict: NOT READY.**