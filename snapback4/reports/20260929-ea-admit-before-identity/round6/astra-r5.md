One Medium remains.

1. **Medium — refreshing an unchanged backend falsely refuses a waiting mutation.** [identity-admission.ts:121](/home/ccheever/sb4-intent/review-ea-r5-astra/snapback4/packages/snapback4/src/identity-admission.ts:121)

   Reopen offline with a cached backend and an uninstalled native module. Submit a mutation, then reconnect while its final identity read is pending. A native query refreshes `/schema` and installs the module. The waiting mutation returns `E_ADMISSION_STORE`, although the store, generation and programs have not changed.

   The comparator uses raw `JSON.stringify`. Device-restored programs are sorted by name and omit execution fields such as `predicts`, `requires` and `sites`; `/schema` includes those fields and uses a different program order. Removing `native` from the comparison therefore does not fully fix descriptor enrichment.

   I reproduced this with a real server, process device and native module: **zero admissions, zero mutation POSTs, empty outbox, false store refusal**. The supplied test misses it because [admit-before-identity.test.mjs:652](/home/ccheever/sb4-intent/review-ea-r5-astra/snapback4/packages/snapback4/test/admit-before-identity.test.mjs:652) clones the cached representation to construct its refreshed response.

   **Smallest fix:** compare normalized semantic backend contents: stable object ordering, programs sorted by name, and their common interpreter fields. Preserve schema comparison and store/generation/fingerprint checks. Add the real cached-backend-to-`/schema` regression. That normalization, tested only in my copy, passes the reproduction and all three existing descriptor/schema/program controls.

2. **Low — suspended-runtime deadline enforcement lacks a detecting test.** [admit-before-identity.test.mjs:336](/home/ccheever/sb4-intent/review-ea-r5-astra/snapback4/packages/snapback4/test/admit-before-identity.test.mjs:336)

   Deleting both post-I/O `Date.now() >= deadline` checks still passes **all 48 supplied identity tests**. That mutation admits a call whose final identity completes after 15 seconds but before the overdue timer callback runs.

   **Smallest fix:** advance mocked wall time without executing timers, then resolve the held final read and require `E_ADMISSION_TIMEOUT` with zero admissions. My added probe passes production and fails that mutation. Production currently handles this correctly.

The enumerated round-3 and round-4 blockers are fixed and have detecting coverage:

- First-identity store/backend pins and final revalidation; deleting the final recheck now fails both replacement controls.
- Final-read hangs, rejection and temporary unreadiness; same-ID retry after asynchronous `E_ADMISSION`.
- Adoption-required readiness, native transactional fencing and public empty-store refusal.
- Browser backend and generation forwarding; removing either fails the corresponding wasm and Worker controls.
- FIFO deadlines across predecessor identity I/O and ordinary admission intervals; regressing the pause condition fails both deadline controls.

The simplification is sound. I found no surviving durable pre-identity mutation machinery. Ordinary prediction, custody, ordering, authorization and write-ID deduplication otherwise appear preserved. Reload loss is documented honestly, and the refusal codes provide actionable repairs.

Temporary-copy checks passed **65/65 identity/online-journal**, **57/57 lifecycle**, and **28/28 write-ID/explicit-sync** tests. The review worktree remains unchanged; no commit was made.

**Verdict: NOT READY.**