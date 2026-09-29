Most prior findings are fixed with detecting tests. **The slow-transfer finding remains unresolved for buffered hosts.**

I ran `git diff b7d05baff..957d7961c`. Tests and probes ran only in temporary copies; the reviewed worktree is unchanged.

| Prior finding | Verification |
|---|---|
| Effect restart exposes revoked handle | Fixed. Activity hide/reveal test fails when lifetime validation is removed. |
| Transient failure permanently latches selection | Fixed for safely retryable downloads. Recovery passes across online, process and wasm; disabling recovery fails the hook tests. |
| Initial non-null StrictMode double-fetch | Fixed. Removing deferred dispatch produces two requests and fails the test. |
| Obsolete completion race | Fixed. Publishing the obsolete result after current readiness fails the reverse-completion test. |
| Healthy transfer exceeds five seconds | Streaming path fixed: real ordinary and one-view hooks reached `ready` and painted after approximately **6 seconds**. Buffered path still fails; finding below. |
| Stalled refusal body loses `Retry-After` | Fixed. Delta-seconds and HTTP-date tests detect removal of deadline preservation. |
| Credential rotation bypasses admission backoff | Fixed. Both response-time and backoff-boundary tests exist; restoring immediate recursion fails. |
| Missing cooldown/lost recovery-event coverage | Fixed. Real downloader outcomes exercise early focus/reconnect, deferred recovery, busy events and cancellation. Removing the cooldown guard fails. |
| Bare 502/503/504 becomes terminal | Fixed. Explicit recovery tests detect removal of status-based retrying. |
| Local rotation invalidates cache and latches `E_AUTH` | Fixed. Process and wasm tests retain the existing handle and resolve all 34 queued calls. Removing the fix fails both. |

1. **Medium — Buffered fetch still has a five-second total transfer deadline.** [asset-download.ts:106](/home/ccheever/sb4-intent/review-av-r2-astra/snapback4/packages/snapback4/src/asset-download.ts:106)

   The timer starts before `doFetch`. A host that resolves fetch only after buffering the body cannot report the progress needed to renew it. The streamless Blob path has the same problem at line 63.

   I repeated the real six-second HTTP transfer through a completion-only fetch adapter. The ordinary hook made four requests and returned `error/E_OFFLINE` after **22.1 seconds**. The one-view hook made one Range probe and one non-range request, then returned a non-retryable error after **5.0 seconds**, without displaying the image. Both streaming controls painted successfully.

   This models buffered-host behavior; it is not a native-device qualification. The documented limitation leaves the round-1 regression in `client.asset` and `useAsset`.

   **Smallest fix:** separate buffered transports’ whole-transfer timeout from the five-second streaming inactivity timeout, or supply native progress notifications. Add the completion-only version of the real six-second test and require both ordinary and one-view readiness.

2. **Low — Empty chunks can defeat the timeout without a detecting regression.** [asset-retry.test.mjs:80](/home/ccheever/sb4-intent/review-av-r2-astra/snapback4/packages/snapback4/test/asset-retry.test.mjs:80)

   **Verified surviving mutation:** replace `if (value.byteLength)` with `if (true)` at `asset-download.ts:70`. All **146 focused tests still pass**.

   A custom stream emitting empty chunks every two seconds then renews both deadlines indefinitely without delivering bytes. My probe confirms the fixed implementation aborts while the mutant remains active.

   **Smallest fix:** enqueue empty chunks across the five-second boundary and assert cancellation and bounded recovery. The production guard is already correct.

The ownership fix is sound: I found no publication of another id’s, client’s or signed-out session’s handle. Late results are released, Activity cannot revive revoked URLs, and viewer discovery does not consume another view. Terminal refusals stop retries; ambiguous one-view downloads are not replayed. Already-delivered bytes still require the documented home-row viewer lifecycle for revocation.

Recovery is bounded per invocation and preserves admission cooldowns. Exhaustion produces an explained `error`; subsequent recovery requires an eligible event. I found no remaining failed-download path that silently stays `loading` indefinitely.

The author-avatar recipe is accurate: the profile supplies authorization, the hook is unconditional, and loading, empty, denied and error outcomes remain distinguishable. The LLP records the implemented ownership and recovery rules accurately, including the buffered-host limitation.

The d-02 investigation supports **“original incident unreproduced.”** Fresh-store, frozen-export and multi-tier evidence establish that the pattern works. The strongest explanation remains a transient asset GET failure on 0.4.8—such as a reset or 503—latched by the old hook and hidden as initials. Feed and bubble requests can occur in different waves. The grader captured neither hook outcomes nor failed responses, so caching, scoping or rendering cannot be conclusively excluded, but have weaker supporting evidence.

**315 existing tests passed** across two focused runs. The buffered-transfer regression should stop landing.

**Verdict: NOT READY.**