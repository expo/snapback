Two issues remain.

1. **High — browser admission drops the pinned backend fingerprint before commit.** [snapback4/packages/snapback4/src/web-journal.ts:346](/home/ccheever/sb4-intent/review-ea-r4-astra/snapback4/packages/snapback4/src/web-journal.ts:346)

   A waiting call identifies backend A and passes synchronous journal capture. Before its admission transaction runs, an already queued adoption changes the backend fingerprint while preserving the store ID and generation. The transaction checks generation, readiness and store ID, but never checks `expected_backend`.

   I reproduced this in both wasm and Worker browsers: the call returned `pending` instead of `E_ADMISSION_STORE`; wasm also issued `/m`.

   **Smallest fix:** forward `expected_backend` through both browser adapters into the journal admission plan, and compare it with `device:backend-identity` inside the serialized admission transaction. That correction, tested only in my copy, made both reproductions refuse with an empty outbox and zero POSTs.

2. **Medium — the deadline pauses behind another call’s identity I/O, even when no ordinary admission has started.** [snapback4/packages/snapback4/src/identity-admission.ts:62](/home/ccheever/sb4-intent/review-ea-r4-astra/snapback4/packages/snapback4/src/identity-admission.ts:62)

   Submit A and B. Both initial checks succeed; A’s final identity read stalls. B clears its timer while awaiting `previous`, although A is still identifying. At 15 seconds A times out, but B receives its remaining budget starting then. A stalled final read for B therefore extends its unadmitted wait to 30 seconds. Longer bursts compound this.

   My fake-clock reproduction leaves B pending at 15 seconds with **zero admission calls**. This exceeds the documented exemption for earlier ordinary admissions.

   **Smallest fix:** distinguish predecessor identity work from predecessor ordinary admission. Pause the deadline only during actual ordinary admission; keep it running while predecessors perform identity checks.

The specific round-3 regressions are now detected: the two first-identity replacement cases pass, final-read hang/rejection cases produce public refusals, and same-ID storage retries pass in wasm and Worker. Deleting the final recheck now fails both replacement controls.

Coverage still misses the browser transaction boundary: removing `expected_generation` forwarding from both browser adapters passed **all 39 supplied identity tests**.

The simplification is sound. I found no surviving durable pre-identity mutation machinery. Reload loss is documented honestly, and the public refusal codes provide concrete repair instructions. The supplied identity/online-journal tests passed **56/56**; lifecycle, write-ID and explicit-sync tests passed **85/85**. Ordinary prediction, custody, authorization and deduplication otherwise appear preserved.

All tests and experimental edits were confined to a temporary copy. The review worktree remains unchanged.

**Verdict: NOT READY.**