**CHANGES_REQUIRED**

Two material cancellation gaps remain in the final code.

1. **P2 — Cancellation still strands recovery during outbox replay.**  
   Location: [client-outbox.ts:161](/Users/ccheever/clique-improvement/reviews/auth-r3/snapback2/packages/snapback2/src/client-outbox.ts:161).

   Reproducible interleaving:
   - Start deferred startup recovery with a durable queued intent. Let `/api/resume` succeed, then hold its replay `/api/mutation` indefinitely in transport that ignores abort.
   - Call `offline()`, then `online()` with healthy subsequent transport.
   - `withAbort` releases the outer resume barrier, and replacement recovery starts. But its drain queues behind `runtime.drainTail`, which still awaits the cancelled replay at line 189.
   - Reconnect, replay, and operations joining replacement recovery remain blocked indefinitely.

   **Fix direction:** Make the resume-owned drain’s existing barrier settle on cancellation, or abort-race its transport awaits so the drain unwinds. Preserve FIFO and late-result fencing. Add a regression withholding the old replay response until replacement recovery completes.

2. **P2 — A cancelled resume can clear custody after replacement recovery succeeds.**  
   Location: [client.ts:888](/Users/ccheever/clique-improvement/reviews/auth-r3/snapback2/packages/snapback2/src/client.ts:888).

   Reproducible interleaving:
   - Return HTTP 401 headers for the old `/api/resume`, but hold its `response.json()` body. Execution waits inside `responseRefusal()` at line 873.
   - Call `offline()`, then complete `online()` and replacement recovery under the same bearer.
   - Release the old body containing `E_AUTH_SESSION`.
   - The cancelled request calls `expireSession()` **before** checking abort at line 898. Matching custody is cleared and the partition sealed despite completed recovery.

   The JSON-error catch at lines 915–920 similarly lacks an abort check before recording a late refusal.

   **Fix direction:** Check cancellation after body parsing, including failure paths, before custody or snapshot effects. Preserve the separately specified late-`me()` evidence behavior. Add a regression that delays the body after headers arrive.

The new tests cover cancellation while awaiting `/api/resume` fetch; they do not cover these interleavings. The earlier outer-barrier hang appears addressed.

**Optional coverage:** Extend delayed carrier-read fencing to live subscriptions where the transition starts during carrier I/O.

Static review only: read both patches, relevant source/tests/LLPs, and only `prior-astra.md` among reviewer files. No edits, tests, network, or credential access. The reported 173 passing tests were not independently verified.