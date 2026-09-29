I found three defects that should stop landing.

1. **High — a waiting call can switch stores after identification.** [snapback4/packages/snapback4/src/local.ts:1263](/home/ccheever/sb4-intent/review-ea-r3-astra/snapback4/packages/snapback4/src/local.ts:1263)

   Reopen offline with a cached, never-identified backend: its cached backend has no `store_id`. Submit two writes; both observe store A, but hold the first admission. Replace A with B using the same schema and generation, then release admission. I reproduced the first write refusing `E_ADMISSION_STORE` while the second becomes durably queued in B.

   The second check compares against the absent `capturedBackend.store_id`, then overwrites the admission identity with B. **Smallest fix:** pin each call’s store identity and backend fingerprint on its first successful identification; subsequent checks must compare against those pinned values.

2. **Medium — final identity revalidation can hang indefinitely or escape without a public refusal.** [snapback4/packages/snapback4/src/identity-admission.ts:58](/home/ccheever/sb4-intent/review-ea-r3-astra/snapback4/packages/snapback4/src/identity-admission.ts:58), [identity-admission.ts:61](/home/ccheever/sb4-intent/review-ea-r3-astra/snapback4/packages/snapback4/src/identity-admission.ts:61)

   Even with one caller and no predecessor, the first successful check cancels the timer before the final asynchronous check. Hold that second device read: after advancing the clock 60 seconds, the promise remains pending and nothing has been admitted. Reject that read instead: `mutate()` rejects with the raw exception, bypassing `refused()` and `onWrite`.

   **Smallest fix:** keep final identity I/O deadline-bounded and route its failures through the public refusal callback. Preserve the separate allowance for waiting behind an earlier ordinary admission.

3. **Medium — waiting breaks the documented same-ID retry after `E_ADMISSION`.** [snapback4/packages/snapback4/src/local.ts:1261](/home/ccheever/sb4-intent/review-ea-r3-astra/snapback4/packages/snapback4/src/local.ts:1261)

   Submit before identity, then make localStorage reject the ordinary admission journal write. The call returns `E_ADMISSION`, explicitly instructing a same-ID retry. Repair storage and retry: it returns `E_WRITE_RECEIPT_EXPIRED`. I reproduced this in both wasm and Worker browsers.

   `IdentityWait.run()` wraps the tagged `failedAdmission()` promise, hiding the synchronous marker that `MutationIds.run()` uses to release an unadmitted reservation. **Smallest fix:** release that reservation when the asynchronous result is `E_ADMISSION` too.

The simplification itself is sound: I found no remaining durable pre-identity custody machinery. Ordinary prediction, authorization, outbox delivery and server deduplication are preserved apart from the admission issues above. The reload-loss documentation is honest, and the new refusal codes give concrete repair instructions.

In a temporary copy, the supplied identity and online-journal tests passed **43/43**. Their coverage misses these cases: deleting the final identity recheck entirely still passed **all 26 identity tests**. The original worktree remains unchanged.

**Verdict: NOT READY.**