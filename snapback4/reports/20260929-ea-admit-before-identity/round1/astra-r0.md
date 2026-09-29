Three landing blockers reproduced on copies; the reviewed worktree remains unchanged.

1. **High — accepted native writes can disappear.** [native-admission.ts:40](/home/ccheever/sb4-intent/review-ea-r0-astra/snapback4/packages/snapback4/src/native-admission.ts:40)

   Owner A loads an empty deferred queue and pauses before saving. Owner B durably accepts write B. An overlapping `sync_state` call in A refreshes the shared `expected` variable to B’s new metadata. A then saves its old snapshot using that newer comparison value: the CAS succeeds and erases B.

   Reproduced with two real SQLite device processes: both admissions returned success; durable metadata contained only A afterward. B cannot survive reload or reach settlement.

   **Smallest fix:** keep the CAS expectation local to each plan attempt. State reads outside the admission chain must not change that attempt’s comparison token.

2. **High — timeout can permanently report an executed write as unsent.** [app-online.ts:190](/home/ccheever/sb4-intent/review-ea-r0-astra/snapback4/packages/snapback4/src/app-online.ts:190)

   Runtime A accepts a charge while its identity probe is unavailable. Runtime B recovers the shared intent, identifies the store, persists `dispatched: true`, and executes the charge. A still holds its original `admissionDeadline` and expires it without checking current journal custody.

   With B’s response held, A emitted `E_ADMISSION_TIMEOUT`, deleted the dispatched intent, and persisted “was not sent.” Releasing B’s successful response did not repair that durable failure. The advised new-ID retry can duplicate the charge. With B already settled, A still emitted the false failure.

   **Smallest fix:** adjudicate expiry inside the journal lock against the current intent and receipt. Never expire dispatched custody; recover an existing terminal outcome instead of emitting another.

3. **High — deferred recovery bypasses exact input deduplication.** [identity-admission.ts:122](/home/ccheever/sb4-intent/review-ea-r0-astra/snapback4/packages/snapback4/src/identity-admission.ts:122)

   A captures write X with `{value: true}` before identification and pauses. B identifies the shared SQLite store and ordinarily admits X with `{value: false}`. A then commits deferred custody. After A adopts the identified store, recovery finds X by ID alone and marks A’s intent admitted using B’s entry.

   Reproduced against SQLite: both submissions were accepted; A’s queue subsequently contained `{value: false}`. Passing A’s original input through ordinary admission correctly returned `E_WRITE_ID_REUSE`.

   **Smallest fix:** atomically compare operation, arguments, and viewer across deferred metadata and the ordinary outbox when admitting either kind of custody. Reject the conflicting caller while preserving the winner; an ID-only recovery match is insufficient.

The ordinary single-owner flow is sound in its basic structure: prediction and transport wait for identification, original IDs are retained, and pending custody is exposed. The existing interpreter and server remain responsible for prediction eligibility and authorization. The new refusals are documented and actionable when their “unsent” premise is true.

The reported test counts do not cover these interleavings. A concrete surviving mutation in the native handoff test is removing the store-ID comparison from `require_admission_identity`: [admit-before-identity.test.mjs:274](/home/ccheever/sb4-intent/review-ea-r0-astra/snapback4/packages/snapback4/test/admit-before-identity.test.mjs:274) changes generation, so the remaining backend-fingerprint check still passes that test. Add a same-generation incarnation replacement at that boundary, alongside the three reproduced scenarios.

**Verdict: NOT READY.**