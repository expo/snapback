I'll review the AV asset-resolution change read-only: first the lane prompt, the round reports, and the diff, then I'll check each prior finding against the code and tests.The branch is three commits past the base. Next I’ll read the prior reviews and the round 1–2 reports, then check the hook and download code against those findings.Prior reviews name specific defects. I’ll read the hook, downloader, and the tests that are supposed to catch each one.Auto-compacting conversation (81% full)...
Conversation compacted.
The prior pass left the six-second transfer unrun and a few line citations unchecked. I’ll confirm those against the tree, run that transfer on a copy outside the worktree, and then write the review.The round 0 and round 1 defects are fixed in the streaming downloader. Two Mediums should be fixed before this lands. This does not close calibration d-02.

I ran `asset-retry.test.mjs` on a copy of the current sources: 28/28 passed. That includes the real loopback video, one byte every 500 ms, 12 bytes, one request, `ready` in 6.04 s. A second request in that test is poisoned with `E_RULE`, so a retry would have failed it. I did not run the React harness, the avatar integration, `online-session.test.mjs`, or `scripts/test.sh`. The worktree was not modified.

## 1. Correctness

`useAsset` does not hand a handle to the wrong id, client, or signed-out session. The render gate is `resolved.owner === owner && resolved.lifetime.live`, and `owner` is `{ client, signedOut, id }` (`react.tsx:330`, `react.tsx:390`). An id, client, or sign-out change renders `loading` or signed-out `E_AUTH` before effect cleanup revokes the previous URL. A late result with `live === false` revokes and does not publish (`react.tsx:347-349`). Sign-out with a non-null id does not fetch (`react.tsx:334`, `react.tsx:389`). Viewer discovery is deliberately not part of the key, so it does not burn a second view.

Rapid id or owner changes flicker to `loading` and do not stick. The last live effect still loads. An already-ready handle is not refetched when the link drops. A view-once body is not replayed after an ambiguous failure: the one-view reset, body-reset, timeout, and malformed-refusal tests passed, and the server refuses `Range` before it records a view (`assets.rs:63-77`, `assets.rs:128-131`). Hiding an Activity revokes that mount’s blob URL; revealing it is a new fetch. A one-view photo must stay on the explicit viewer, which the guide already says.

A revoked home does not pull a URL that is already `ready`. That is the old “do not refetch a ready handle” rule, not a cross-id leak.

A valid download can still stick.

**Medium.** `snapback4/packages/snapback4/src/client.ts:1010` and `snapback4/packages/snapback4/src/local.ts:1326`.

`refreshCurrent` bumps `credentialRevision` before the new bearer is installed (`local.ts:428`, again at `local.ts:464`; online at `client.ts:429`). `downloadAsset` does not drop a body it has already received. Both `asset()` implementations then revoke that URL and return non-retryable `E_AUTH` (“the view may already have been consumed”) without another request. `useAsset` will not recover: `E_AUTH` is not an `assetError` (`asset-download.ts:7`, `react.tsx:364`). Remounting a one-view asset then gets `E_ASSET_VIEWED`, so the only view was delivered and thrown away. An ordinary avatar stays on initials until the id or the client changes. Feed rows that finished before the refresh stay painted; rows still in flight do not. That split needs a refresh overlapping the download. Refresh is the 24-hour-before-expiry timer (`local.ts:50`), not every mount, so this is not the fresh-store d-02 run. It is still a permanent non-ready state for bytes the client already holds.

The local client has a second window because `asset()` never awaits `refreshing` (`local.ts:1308`; the online client does at `client.ts:993`). A call that starts after the first bump still sends the old bearer under a revision that matches. A 401 that arrives before the second bump misses the early return at `local.ts:1313`, `invalidate`s retained bytes (`local.ts:1323`), and returns that `E_AUTH`. `refusedSession` does not end the session while `rotating` (`local.ts:405`). The 34-avatar test does not cover this: it finishes `refreshSession()` before unblocking the queue (`asset-avatars.test.mjs:55-57`).

`online-session.test.mjs:288` and `overload.test.mjs:173` require the success path to come back `E_AUTH` with the URL revoked. They freeze the harm. “Do not replay” does not require destroying a completed body.

Smallest fix: if `"url" in read` and the client is still signed in as the same principal, return that handle and do not fetch again. On the local client, `await refreshing` before `requestCredentials()`, as the online client already does, so the recursive `E_AUTH` retry waits for the new bearer and the intermediate revision is never used. Do not `invalidate` on `E_AUTH` while `rotating`.

## 2. Transient recovery, and d-02

Recovery of a single streaming failure is bounded and explained. Resets, bare 408/429/500/502/503/504, and a host that ignores abort retry with a full-file `Range: bytes=0-`, at most four attempts and ten seconds of backoff. I ran those tests. A `Retry-After` of 60 seconds ends the call after one request and is stored on the refusal before the body is read. A stalled 503 body keeps `E_HTTP_RESPONSE`, `retryable: true`, and the deadline `160000` for both delta-seconds and an HTTP-date; it does not invent `E_RATE_LIMIT`, so it cannot authorize replaying a one-view transfer. Jitter never shortens the wait. Missing, revoked, consumed, and `E_AUTH` / `E_RULE` stop even if the wire says `retryable: true`.

The hook retries only a denial whose code is an `assetError` and whose `retryable` is true, and only on link `online`, `focus`, browser `online`, or `visibilitychange`. An event before `assetRetryAt` arms one timer. An event while busy runs once after the outcome. Ready handles and terminal refusals do not restart. There is no path through `downloadAsset` that leaves the hook at `loading` forever: a fetch or `Blob` that ignores abort still rejects when the stall timer fires (`asset-download.ts:33-40`), and the hook publishes `error` or `denied` with `why.message`.

What is left:

**Medium.** `snapback4/packages/snapback4/src/asset-download.ts:91` and `snapback4/packages/snapback4/src/local.ts:1318`.

The thirty-second clock starts when `downloadAsset` is entered and is renewed only by a nonempty body chunk (`asset-download.ts:89-93`, `asset-download.ts:116`). Queue wait does not renew it. A probe with six progressing streams held the six slots; the seventh returned at 30 seconds, having sent nothing, as retryable `E_OFFLINE` with `assetRetryAt` 0 and the message “no byte progress for 30000 ms including queue wait”. The local client treats every asset `E_OFFLINE` as the device being offline (`local.ts:1318`). `setLink("offline")` publishes every fresh query as `{ loading: true }` and reruns watches (`local.ts:339-355`). The probe then marks the link online, `useAsset` recovers, and the seventh call queues again. While the six bodies keep trickling, the replica oscillates offline about every 30 seconds. The online client does not do this. The calibration app is a local client.

The same clock eats a legal admission wait. After 22 seconds in queue, one 503 with `Retry-After: 9` was admitted. The lifetime abort fired during that pause. The next loop does not notice `lifetime.signal.aborted` (`asset-download.ts:98` checks only `current()` and the caller signal; the lifetime check at `asset-download.ts:150` already passed). The new attempt throws, replaces the stored `E_RATE_LIMIT`, and returns retryable `E_OFFLINE` with `retryAt` 0. The hook may retry immediately, and the local client again calls `setLink("offline")`. This only happens when admission falls in the last 10 seconds of the clock and the server’s minimum still fits the 10-second backoff budget. The outage above does not need a 503.

Smallest fix: if `lifetime.signal.aborted`, return `previous` unchanged (`asset-download.ts:98`). In local `asset()`, do not call `setLink("offline")` for an SDK inactivity deadline that never saw a socket failure. Renewing the 30-second clock when a slot is acquired is the better definition of inactivity, but LLP 3000.008.002.000 §6 currently says the deadline includes admission wait, so that sentence has to move with the code.

**Low.** `snapback4/packages/snapback4/src/assets.ts:127`.

Any throw after a successful body, including `viewed()` failing to retain an ordinary avatar, is forced to `retryable: false`. The base client used `offline(error)`, which is retryable. The hook shows an explained `E_OFFLINE` and will not retry it on focus. A one-view failure should stay non-retryable. A retention failure of an ordinary body should not.

Smallest fix: force `retryable: false` only for the non-range one-view attempt.

Buffered `response.blob()` with no `response.body` still dies at five seconds (`asset-download.ts:63`). That matches the round 2 write-up. Browsers and undici expose a stream, which is what the 6-second test exercised. Native views are supposed to use `assetSource`. I would not block on it.

**d-02.** “Unreproduced on a fresh store” is well supported for a deterministic “this pattern never becomes ready” bug. It is not evidence about the original grader session: there is still no hook value, no failed asset response, and no served build hash. The most likely cause is a transient GET on the later bubble wave against 0.4.8. At the base of this diff, `fetchAsset` retried only an explicit retryable `E_RATE_LIMIT` and then waited on `response.blob()` with no stall bound. A reset or a bare 503 settled as `denied` for that selection; a hung body stayed `loading`. Feed avatars that had already reached `ready` stayed painted. Initials hid every non-ready state. Caching and the stale-handle bug do not explain “later mounts of the same id can succeed.” This branch retries those streaming failures inside one `client.asset` call, which I ran. After the four attempts, the hook waits for reconnect, focus, or visibility, and the error names the cause. That is not a silent permanent `loading`. The original ticket should stay open. The rotation latch above can recreate the same feed-versus-bubble split, but only when a refresh overlaps the in-flight wave, which a fresh session outside the 24-hour window does not do.

## 3. Guide recipe

The author-avatar recipe in `guide.rs:474-511` matches the client. `useAsset` is unconditional. `useQuery` is a `Read`: `data`, `loading`, or `denied`. A point read of a missing profile is `data: null`, and `author?.avatar?.id ?? null` is `empty`, not a failed download. `Asset` has `id` (`contract.ts:204-206`). `denied` and `error` both read `avatar.why.message`, not `denied.why`. The prose after the sample (`guide.rs:513-546`) matches the hook: transport failures are `error`, authorization and consumed views stay `denied`, recovery waits out `Retry-After`, a ready handle is not refetched, and one-view photos are pointed at the explicit viewer. The round 1 `denied.why` wording is gone.

## 4. Landing and test strength

Do not land the two Mediums. The stale-handle, StrictMode, stall-bounded stream, Retry-After-before-body, bare 5xx, and admission-custody fixes are real.

The mutation that survives: empty `progress` in `asset-download.ts` so the 30-second timer is never armed. I rebuilt that copy and `asset-retry.test.mjs` was 28/28 again, including “body progress extends the thirty-second inactivity deadline”. That test only checks that chunks do not abort; the following stall uses the five-second timer. Nothing asserts that 30 seconds without bytes fails, or that queue wait counts.

Deleting `setLink("offline")` in the local asset `E_OFFLINE` branch would also survive the asset tests. Nothing asserts that an asset failure changes the link. I did not execute that edit.

Reintroducing `client.asset` recursion on `E_RATE_LIMIT` would not fail the download-level rotation test I ran (`asset-retry.test.mjs:19`). The detecting test is `online-session.test.mjs:293`, which I did not run. The source no longer recurses except for `E_AUTH` (`client.ts:1007`). The React cooldown test (`react-asset-recovery.mjs:36`, timer delay exactly `55000`) is aimed at replacing the deadline check with `true`. I did not run it.

**Verdict: READY WITH CHANGES.**
