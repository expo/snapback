**CHANGES_REQUIRED**

Static review of the supplied patch and source. I did not execute code or rerun the reported 118 passing tests.

1. **P1 — Recovery can replay the predecessor’s outbox during a queued account transition.**  
   Locations: [client.ts:732](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:732), [client.ts:1262](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:1262).

   **Interleaving:** Seed Alice’s durable queue. On cold startup, queue an Alice login followed by a Bob login before Alice’s transition finishes. Let Alice’s login and metadata succeed; hold Bob’s login response. Alice’s completion calls `resumeAfterAuth()` without waiting for the latest `transitionTail`. It captures Alice’s token together with the operation fence already incremented for Bob’s pending transition. Bob’s `abortResume()` ran when Bob’s transition was requested, before this recovery flight existed.

   Consequently, the recovery’s authority checks pass while Bob’s login is pending, allowing `/api/resume` and queued mutations under Alice’s bearer after the account switch was requested. This violates the transition barrier for newly dispatched work.

   **Fix direction:** Schedule recovery after the latest transition tail settles, then capture and validate authority. Add an offline serialization regression holding the successor login open and asserting no predecessor replay occurs.

2. **P2 — A failed login can cancel deferred startup recovery permanently.**  
   Locations: [client.ts:693](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:693), [client.ts:1281](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:1281), [client-auth.ts:79](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client-auth.ts:79).

   **Interleaving:** A successful startup login installs Alice and starts the new background recovery. Hold its resume response. Submit another login that returns `E_AUTH_INVALID`. That transition aborts recovery. Because the previous snapshot was already authenticated, `restore(previous)` merely restores that snapshot; it schedules no restoration timer. The rejected session exits before reaching `resumeAfterAuth()`.

   `offlineStartupPending` remains true, but no work consumes it. With healthy transport and no further explicit action, the durable queue stays unsent. The added failed-login tests interrupt hydration or `me()`, where restoring a hydrating snapshot schedules a timer; they miss this authenticated state.

   **Fix direction:** After a failed transition preserves confirmed custody, reschedule pending startup recovery once the transition tail is stable. Test cancellation during an active deferred resume and eventual replay exactly once without `online()`, explicit `me()`, or mounted queries.

3. **P1 — Startup interruption after confirmation still poisons `ready`.**  
   Locations: [client.ts:1048](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:1048), [client-auth.ts:163](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client-auth.ts:163), [client.ts:1269](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/src/client.ts:1269).

   This is an **unfixed base defect within the patch’s stated startup-recovery scope**, rather than a newly introduced regression.

   **Interleaving:** Let cold-start `me()` confirm the stored bearer, then hold `/api/manifest`. Invoke login and release a valid manifest response. Login has incremented `operationFence`, so the startup response throws `E_AUTH_SUPERSEDED`. `ClientAuth.initializeOffline()` rethrows that nonretryable refusal, permanently rejecting `ready`. The login itself awaits `ready` before entering its action and therefore never sends its authentication request.

   Subsequent login, `me()`, `online()`, and normal data operations encounter the same rejected promise. Merely retaining `offlineStartupPending` cannot recover this client.

   **Fix direction:** Treat transition-caused startup supersession as deferred startup work, allowing the transition to proceed and recovery to run afterward. Extend the startup timing matrix to pending metadata and pending initial resume.

**Optional followups**

- The [held-read tests](/Users/ccheever/clique-improvement/reviews/auth/snapback2/packages/snapback2/tests/auth-restoration.test.ts:776) begin the query after login starts. Add delayed carrier reads where authority changes **after the read begins**, exercising both new post-read checks.
- After successful deferred recovery, age a newly queued intent past the fence and perform an ordinary relogin with healthy transport. Assert that relogin starts no implicit resume or replay. The new startup tests exercise only fresh intents and the first recovery.