**CHANGES_REQUIRED** — `f7d251394` against `a897055f8`.

The three reported residual cases are resolved by inspection. One new material regression remains:

**[P2] Supersession can bypass terminal-session invalidation.**  
The new [authority check at client.ts:292](/Users/ccheever/clique-improvement/reviews/assets-r3/snapback2/packages/snapback2/src/client.ts:292) can throw before the terminal result reaches `expireSession()`.

Static reproduction, not executed:

1. Without an outbox, let a mutation encounter `E_NETWORK`, leaving connection state `reconnecting`.
2. Have the next mutation return HTTP 200 with a valid `rejected / E_AUTH_SESSION / auth` envelope.
3. In `subscribeStatus`, start a login when that response changes connection state to `connected`; make the login fail with `E_AUTH_INVALID`.

[JSON transport publishes that notification](/Users/ccheever/clique-improvement/reviews/assets-r3/snapback2/packages/snapback2/src/client.ts:898) after its authority checks. Login increments the fence, so the new `validated()` throws `E_AUTH_SUPERSEDED` before expiry runs. The failed login then retains the known-invalid bearer in memory and token storage and restores the authenticated snapshot. Previously, the terminal branch expired the original custody before suppressing the superseded receipt.

**Fix direction:** When pre-cleanup validation rejects a terminal result, expire its captured token custody before propagating supersession. Current-authority results should still retain their bearer through discard.

**Optional coverage:** Pausing an actual finalizer between reservation and blob publication would strengthen the existing interleaving coverage; this remains nonblocking.

Static review only. No edits, tests, network, credentials, or other reviews accessed. The reported **99 JS / 62 Rust passes** and failing-before reproductions remain author-supplied evidence.