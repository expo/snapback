**CHANGES_REQUIRED**

**P2 — Cancelling deferred startup recovery can strand reconnect indefinitely.**

Locations: [recovery barrier assignment](/Users/ccheever/clique-improvement/reviews/auth-r2/snapback2/packages/snapback2/src/client.ts:736), [abortResume](/Users/ccheever/clique-improvement/reviews/auth-r2/snapback2/packages/snapback2/src/client.ts:1129), [operationAuthority](/Users/ccheever/clique-improvement/reviews/auth-r2/snapback2/packages/snapback2/src/client.ts:1258).

Concrete interleaving:

1. With Alice’s durable queue present, login interrupts startup and succeeds. Deferred recovery starts; hold its `/api/resume` response in a fetch that ignores abort.
2. Call `offline()`. It aborts the controller and clears `resumeFlight`, but leaves `resumeTail` awaiting that response.
3. Call `online()` with healthy subsequent transport. It awaits `operationAuthority()`, which awaits the obsolete `resumeTail` **before replacement recovery can start**.
4. Reconnect and replay remain blocked until the obsolete transport settles, potentially forever.

The same barrier can strand callers already waiting when a failed login cancels recovery—even if the replacement recovery succeeds.

**Fix direction:** Make cancellation settle the recovery barrier independently of transport completion, wake existing waiters, and recheck current transition/recovery authority before dispatch. Merely replacing the `resumeTail` field does not release callers already awaiting its old promise. Add a regression withholding the old response until reconnect and replay complete.

This remains from `a6a46b5a3`’s deferred-recovery path; it is an additional defect in the final patch, rather than one uniquely introduced by this revision.

The prior material findings are resolved for their reported interleavings:

| Concern | Static assessment |
|---|---|
| Queued successor permits predecessor recovery | Resolved: recovery captures authority after the latest transition settles. |
| Failed login cancels authenticated recovery permanently | Resolved: transition rejection schedules replacement recovery for preserved custody. The barrier defect above remains separate. |
| Startup supersession poisons `ready` | Resolved: abort races the entire initialization pipeline, including metadata and resume. |
| Metadata failure skips pending recovery | Resolved: successful session completion schedules recovery regardless of `offlineMetadataLoaded`. |
| One-shot/live startup held reads cross identity | Resolved: transition barriers and post-read authority checks cover these shortcuts. |
| Ordinary relogin releases past-fence queue | Resolved: completed recovery clears the pending flag; ordinary relogin does not implicitly resume. |

**Optional coverage:** Extend the delayed-carrier test to live subscriptions where the transition begins after carrier I/O starts. The added live tests begin during an existing transition.

Static review only: read both patches, relevant source/tests, LLP1002/1012, and only `prior-astra.md`. No code/tests, edits, network, or credential access. The reported 130 passing tests were not independently verified; broad timing failures are not treated as green.