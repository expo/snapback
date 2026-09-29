Four findings remain. I reviewed `git diff 398552255d..04f8ef489e`; the checkout is unchanged. Tests and mutations ran only on a copy.

The reported round-0/1 schedules now pass: two-process native CAS overlap and exact-input conflicts; native cached-emptiness binding/FIFO; native and online expiry after peer execution; staged web replacement; restore visibility; timely publication across reopen and native overlap; and successful late online probes. Deleting the pre-admission freeze save now **fails** its peer-expiry detector.

1. **High — failed receipt persistence releases custody of a known success.** [app-online.ts:130](/home/ccheever/sb4-intent/review-ea-r2-astra/snapback4/packages/snapback4/src/app-online.ts:130)

   A journals a write while its probe waits. B recovers it, receives `sent`, but saving that receipt fails. The settlement promise catches the failure through `retain()`, so `after()` releases the dispatch claim despite lacking a durable receipt. A’s probe then identifies a replacement; A acquires the claim and permanently replaces the pending intent with `E_STORE_REPLACED`.

   Reproduced with two production online clients and controlled transport/storage. After storage repair, B’s consecutive `write(id)` calls returned **`sent`, then `failed`**. There was one POST. The previous successful-probe fix therefore remains incomplete under receipt-storage failure.

   **Smallest fix:** retain the dispatch claim while retrying persistence of a known terminal outcome. Release it after durable settlement, transport retry without a known outcome, or owner teardown. A caught persistence failure must not count as settled custody.

2. **High — online ordering is local to one owner, despite a shared durable queue.** [app-online.ts:251](/home/ccheever/sb4-intent/review-ea-r2-astra/snapback4/packages/snapback4/src/app-online.ts:251)

   Open A and B against the same empty journal. A durably accepts `FIRST` while its identity probe waits. B then accepts `SECOND` and identifies immediately. B’s private `admissions` chain contains no `FIRST`; the per-ID dispatch claim imposes no ordering between different IDs.

   Reproduced POST order: **`SECOND, FIRST`**, although durable admission order was `FIRST, SECOND`. Dependent operations can consequently fail or produce the wrong result.

   **Smallest fix:** select dispatch from the shared journal’s FIFO under its lock. An owner submitting a later entry must recover/drain earlier custody before dispatching its own entry.

3. **Medium — orphan adoption discards evidence of timely identification.** [web.ts:521](/home/ccheever/sb4-intent/review-ea-r2-astra/snapback4/packages/snapback4/src/web.ts:521), also [web-worker-orphans.ts:56](/home/ccheever/sb4-intent/review-ea-r2-astra/snapback4/packages/snapback4/src/web-worker-orphans.ts:56)

   A tab captures a write at t=0 and durably publishes its matching store identity at t=28s. It closes before the next admission poll freezes `record.store`. At t=33s, another replica identifies the same store and adopts the orphan.

   Adoption copies the deferred record but leaves behind the source’s `identity-established` timestamp. Admission consults the destination’s later timestamp and returns **`E_ADMISSION_TIMEOUT`**, despite identification having succeeded within the bound.

   Reproduced in real Chromium on **both wasm and Worker**, plus the production-device model.

   **Smallest fix:** validate and freeze each source record’s timely identification before transferring it, preserving that proof with the record on both web hosts.

4. **Medium — online recovery bypasses an expired deadline when identity is already available.** [app-online.ts:203](/home/ccheever/sb4-intent/review-ea-r2-astra/snapback4/packages/snapback4/src/app-online.ts:203)

   Capture unidentified online custody, close, and reopen after 31 seconds. A query learns the store identity before recovered writes start. Because the timeout loop requires `!dispatchIdentity(raw)`, it skips expiry entirely.

   Reproduced result: **one POST and `sent`**, although the write first identified its backend after its persisted deadline. The existing reopen test keeps the probe unavailable, so it misses this path.

   **Smallest fix:** adjudicate the persisted deadline before first dispatch even when identity is now known, using durable evidence of when matching identification occurred. Continue exempting previously dispatched writes.

The ordinary first-save path is sound in the tested cases: custody survives navigation/reload, IDs and order persist, pending state is visible, and admission enables eligible prediction. I found no prediction-eligibility or authorization bypass, or weakening of server `E_ID_REUSED`. The remaining refusal documentation is actionable; the deadline implementations above do not consistently honor it.

Validation: **58/58** admission/handoff tests, **323/323** delivery-matrix tests, and **71/71** session-model tests with **100 generated sequences** passed. I did not rerun all 10,000 sequences. Native and wasm artifacts matched the report’s hashes.

A demonstrated surviving mutation: reset `identity.deadline` to `Date.now() + IDENTITY_WAIT_MS` inside `IdentityAdmissions.adopt`. **All 58 admission/handoff tests still pass**, despite extending custody’s documented deadline on every orphan transfer.

**Verdict: NOT READY.**