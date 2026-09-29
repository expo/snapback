I'll review the asset-resolution change read-only: first the lane prompt, the round-1 report, and the diff, then check each claimed fix against the code and tests.The lane prompt and round-1 report are in. Next I’ll pull the exact diff range, the earlier findings, and the asset-hook code those findings named.Round 0 named four defects and round 1 claims they are fixed. I’ll read those reviews against the source diff, not the report’s summary.Round 1 says the four round-0 defects and the stuck-hook path are fixed. I’ll read the hook, download path, and the tests that are supposed to catch them.The 5-second download timer looks like it covers the whole body, not just a stalled header. I’ll confirm that against the built client and recheck the local session-cancellation path.The stale-handle fix holds, and the four round-0 defects now have tests that fail if the fix is removed. The branch still cannot land. A transfer that takes longer than five seconds never becomes ready, and a local session change during download deletes retained bytes and sticks the hook on a non-retryable `E_AUTH`.

## What is sound

`useAsset` does not paint another id, client, or signed-out session. The render at `snapback4/packages/snapback4/src/react.tsx:377` returns a resolved handle only when both the `{client, signedOut, id}` object and the effect-lifetime token are still current. `null` stays `empty` (`:375`). A signed-out non-null id is `E_AUTH` and does not fetch (`:376`). A late `client.asset` result sees `live === false`, revokes a URL, and does not publish (`:345`). Discovering `viewer()` is not part of the key, so it does not burn a second view. Rapid id or client changes flicker to `loading`; they do not apply an older URL, and the last selection is not cancelled by the earlier ones.

Round 0, checked against the current tests:

- Activity hide/reveal cannot return a revoked URL. Cleanup sets `lifetime.live = false` (`react.tsx:367`) and the reveal test requires `loading` while the replacement is held (`test/helpers/react-harness.mjs:744`). Deleting the lifetime check fails that test.
- Initial non-null StrictMode fetches once. Dispatch is a microtask that rechecks liveness (`react.tsx:365`); `react-harness.mjs:755` expects one waiter. Fetching inside the effect body fails it.
- The obsolete completion is resolved after the current one (`react-harness.mjs:702`). Deleting the `return` after the revoke publishes the old owner and the assertion that the hook is still `ready` with `blob:new` fails.
- An independent second hook keeps a usable URL after the first unmounts (`react-harness.mjs:725`).

One-view authorization is unchanged and still safe on this client. The server returns `E_ASSET_RANGE` before recording a view (`crates/snapback4-core/src/engine/mod.rs:760`). The client then makes one non-range transfer. An explicit retryable `E_RATE_LIMIT` may repeat that transfer. A reset, a body failure, a timeout, or a malformed refusal does not (`asset-retry.test.mjs:48`). Mislabelled `E_ASSET_UNKNOWN`, `E_ASSET_VIEWED`, `E_AUTH`, and `E_RULE` stop on the first response. Download backoff is four attempts, from 250 ms, with positive jitter only, a ten-second backoff cap, and `Retry-After` as a minimum. Six bodies run per client. A full-file 206 is cached only when `Content-Range` is `bytes 0-(n-1)/n` and the blob is exactly `n` bytes (`local-assets.ts:154`). `accept-ranges: none` still drops once bytes. An already-ready handle is not refetched when the link drops.

An already-delivered blob stays visible after the server later revokes the home, until the id or the owner changes. That was true before this diff. A second fetch of a once asset is still `E_ASSET_VIEWED`.

## Findings

### 1. High — a body slower than five seconds never becomes ready

`snapback4/packages/snapback4/src/asset-download.ts:80`

The attempt timer is armed before `doFetch` and is cleared only in `finally`. `response.blob()` uses that same signal (`:88`). The thirty-second lifetime abort (`:69`) is armed even earlier and includes queue wait. Neither timer is a stall timeout. A transfer that is still receiving bytes is aborted, retried from byte zero, and aborted again.

I ran this against the source, without changing the tree. Headers returned immediately and `blob()` resolved at six seconds: four attempts, 21991 ms, `E_OFFLINE`, `retryable: true`, no URL. The same shape with a fetch that does not resolve for six seconds failed the same way (four attempts, 22051 ms). A once asset got one Range probe and one non-range body, then stopped at 5023 ms with `retryable: false` and the "may have been consumed" message. `useAsset` will refocus an ordinary failure and hit the same wall. It will not refocus the once failure at all.

A 10 MB image, or any video, on a link slower than about 16 Mbps cannot succeed. The old downloader had no body deadline. Avatars of a few hundred bytes hide this. The existing timeout test only covers a fetch that never resolves, followed by a fast success.

Smallest fix: treat five seconds as silence before headers, and clear that timer when `doFetch` resolves. Do not abort `blob()` on it. Do not apply the thirty-second cap to a body that is still arriving. A once body that has started must be allowed to finish. Aborting it and then refusing a retry is how the only view gets discarded.

### 2. Medium — a local credential change fails the asset and deletes retained bytes

`snapback4/packages/snapback4/src/local.ts:1320`

`downloadAsset` reports "not current" or an aborted caller as `E_AUTH` with `retryable: false` (`asset-download.ts:8`, returned at `:73` and `:83`). That happens at a loop boundary, including while the call is waiting for one of the six slots, before this attempt sends bytes. The online client retries that `E_AUTH` when the credential revision moved (`client.ts:1005`). The local client does not. It calls `media.invalidate(id)`, which revokes live URLs and drops retained bytes, then returns the denial. `E_AUTH` is not an `assetError`, so `useAsset` classifies it as `denied` and will not recover on focus, reconnect, or visibility.

`refusedSession` does not sign the user out in this case: it requires the captured revision to still be current (`local.ts:405`), and this path runs because the revision changed. The session survives. The avatars do not.

Concrete case: a process or wasm client (the chat tier) has forty avatars queued, six active. A normal token refresh bumps `credentialRevision` during the wait. Each waiter returns synthetic `E_AUTH`, wipes that id's cache, and the bubble stays on the initials fallback until the id or the client changes. No server refusal occurred.

Smallest fix: do not use `E_AUTH` for "this attempt has not started and the revision moved." Retry that call with the new credentials, as the online client does, and call `invalidate` only for a server refusal of the asset. A non-range once body that already started must still not be replayed.

### 3. Medium — hook recovery drops the event that was supposed to retry

`snapback4/packages/snapback4/src/react.tsx:357`

`recover` runs only on a link transition to `online`, a `focus` event, a browser `online` event, or a visibility change to visible. If that happens before `assetRetryAt`, or while `busy` is true, it returns and arms no timer. A page that stays focused and never leaves `navigator.onLine` does not retry after the four-attempt budget, even once `Retry-After` has elapsed. The hook state is explained (`error` plus `why`). It is still non-ready for the rest of the mount.

Concrete case: one `E_RATE_LIMIT` with `Retry-After: 60`. The downloader correctly makes a single attempt and records the deadline (`asset-retry.test.mjs:25`). The user alt-tabs back at five seconds. `recover` sees `now < retryAt`, does nothing, and at sixty seconds nothing calls `load`. The bubble stays on initials. The guide's "honoring Retry-After" sentence (`guide.rs:519`) describes a deferred retry this hook does not perform.

This is the remaining shape of calibration d-02 for a burst that outlasts the budget: feed images that already reached `ready` stay painted, later bubble fetches stay non-ready, and the kit hides every non-ready state. It is not silent `loading`.

Smallest fix: if `recover` runs before `assetRetryAt`, arm one timer for the remainder and call `load` once. Clear it on cleanup and on a newer outcome. Do not loop.

## Transient failure and d-02

There is no longer a path through `downloadAsset` that leaves `useAsset` at `loading` with no error. A hung `doFetch` or a hung `blob()` rejects through `bounded` even when the host ignores abort. I observed the explained `E_OFFLINE` above. A thrown `client.asset` becomes `error` / `E_CLIENT` with a message (`react.tsx:353`) and does not retry, because that path sets `read = null`.

The round-1 conclusion is right about attribution and wrong if it is read as "a valid asset can no longer get stuck." The mechanism is real: on 0.4.8 a settled reset or a non-retryable failure stayed `denied` for that selection, a later mount of the same id could still resolve, and the bubble renders initials for every status other than `ready` (`cal26-app` `Chats.tsx`, as cited in the lane report). Feed avatars start from the joined author. Bubble avatars start only after `profileById` resolves, so they are the later wave against a full connection table. That matches 20/20 painted in the feed and 0/20 in the thread after one blip, without a special message-bubble grant. The fresh-store runs, including the frozen export, correctly rule out a deterministic failure of this pattern. They never saw a failed GET. The original grader trace still has no hook value and no asset response, so which blip happened in that session is unproven. Leaving the ticket open is right.

The most likely cause is a transient asset GET (reset, or a 503 that was not an explicit retryable `E_RATE_LIMIT`) on that later wave. It is not a second authorization scope, not cache identity, and not the stale-handle bug. Rendering matters only because the initials placeholder hides `denied` and `error`. Caching would not paint the feed and miss every bubble of the same id unless the feed had already completed and the bubbles had not.

## Guide recipe

The sample is accurate. `useQuery` returns `{data}`, `{loading: true}`, or `{denied}` (`contract.ts:66`). The hook call is unconditional. `profiles[principal = principal]` is one row or null, and an image value is `{id}` or null. `null` is `empty`. `denied` and `error` both show `why.message`. A loading profile supplies no id yet. Once photos are pointed at the explicit-open viewer. The quarry block has a horizon. Account switches replace the client. Viewer discovery does not refetch. Offline does not refetch a ready handle.

The prose at `guide.rs:514` is not accurate. The asset state has `why`, not `denied.why` or `error.why`. A builder who follows the sentence instead of the sample reads `undefined`.

Smallest fix: say `avatar.why` when `status` is `denied` or `error`.

## Test strength

This mutation survives the suite. At `asset-download.ts:99`, drop the anonymous status list and let `transient` be only `overloaded(why)`. Explicit `E_RATE_LIMIT`, resets, once Range refusal, and the malformed-503 test still pass: that test asserts `E_HTTP_RESPONSE` and never the attempt count or `retryable` (`overload.test.mjs:29`). A bare 502/503/504 becomes one non-retryable failure again, which is the 0.4.8 behavior round 1 claims to have closed.

No test downloads a body that takes longer than five seconds and expects `ready`. That is how finding 1 landed.

## Verdict

**NOT READY.** Land the owner check, the StrictMode microtask, and the once Range boundary. Do not land the shared downloader until a progressing body can finish, and until a local credential change retries an attempt that has not sent bytes instead of wiping the cache and latching `E_AUTH`.
