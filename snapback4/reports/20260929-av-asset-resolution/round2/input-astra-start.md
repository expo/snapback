The four round-0 findings are fixed, with detecting tests. On temporary copies, I verified that:

- The [Activity/StrictMode test](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/test/helpers/react-harness.mjs:744) fails when either the lifetime check or deferred dispatch is removed.
- The [recovery test](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/test/helpers/react-harness.mjs:768) fails when recovery is disabled.
- The [reverse-completion test](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/test/helpers/react-harness.mjs:680) fails when an obsolete result can publish.

I found no wrong-id, wrong-client or signed-out handle publication in the revised hook. The ranged/non-ranged boundary preserves one-view safety, and terminal authorization/revocation refusals stop retries. Existing held-byte revocation still requires the documented home-row viewer lifecycle.

Three problems remain:

1. **Medium — Healthy transfers taking over five seconds cannot complete.** [asset-download.ts:80](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/src/asset-download.ts:80)

   The five-second timer includes the entire response body. I reproduced this with a real HTTP response delivering chunks every 500 ms and finishing in 5.5 seconds: direct `fetch` succeeds, but the SDK restarts from byte zero four times and returns `E_OFFLINE` after approximately 22 seconds. Refocus repeats the same failure. This is a regression for valid images/videos on slower connections.

   **Smallest fix:** limit the five-second timer to response acquisition, then allow body consumption within the remaining overall deadline. Alternatively, use a progress-sensitive body timeout. Add the continuously progressing response test.

2. **Medium — A stalled error body discards `Retry-After`.** [asset-download.ts:91](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/src/asset-download.ts:91)

   Retry guidance is read only after JSON consumption. A real HTTP 503 with `Retry-After: 60` and an unfinished JSON body times out, enters the transport-error catch with `minimum = 0`, and retries after approximately **5.3 seconds**. I reproduced the premature second request.

   **Smallest fix:** capture the retry deadline immediately after receiving headers and preserve it through body failure/timeout. A minimum exceeding the remaining budget should end the call and remain attached to the hook’s error.

3. **Medium — Credential rotation bypasses admission backoff.** [client.ts:1005](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/src/client.ts:1005)

   This inherited branch escapes the new policy: start an asset request, rotate credentials, then return retryable `E_RATE_LIMIT` with `Retry-After: 60` for the original request. `downloadAsset` correctly stops, but `client.asset` immediately recurses. My probe recorded both asset requests in the same millisecond. Recursion also starts a fresh attempt/deadline budget.

   **Smallest fix:** return the rate-limit outcome, preserving its retry deadline, instead of immediately recursing for `E_RATE_LIMIT`. Subsequent permitted recovery will use current credentials.

**Low — The recovery cooldown lacks a detecting hook test.** [asset-retry.test.mjs:25](/home/ccheever/sb4-intent/review-av-r1-astra/snapback4/packages/snapback4/test/asset-retry.test.mjs:25)

The test named “long retry guidance survives refocus” checks metadata but never refocuses a hook. **Verified surviving mutation:** replace `Date.now() >= assetRetryAt(read.denied)` at `react.tsx:357` with `true`; all 55 React tests pass. That mutation permits immediate refocus retries during a server-requested cooldown.

**Smallest fix:** obtain a real rate-limit outcome, dispatch focus/reconnect before its deadline, assert no request, then advance time and assert recovery.

The author-avatar recipe is accurate: the profile owns authorization, the hook is unconditional, and profile loading, empty assets, errors and denials remain distinguishable. Its timing guidance needs adjustment with finding 1.

The d-02 investigation supports “original incident unreproduced,” while independently reproducing its likely mechanism. Transient resets/admission failures on 0.4.8 fit the surface difference better than caching or handle scoping: failed bubble mounts remain non-ready while later feed mounts succeed. The app hides denials as initials. Original transport evidence is still missing, so attribution remains appropriately open.

**111 existing tests passed**, including all three client tiers; the additional probes reproduced the problems above. The reviewed worktree is unchanged.

**Verdict: NOT READY.**