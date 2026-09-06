I'll start from the LLP review skill and the immutable snapshot so this stays a scoped re-review of the Snapback2 auth/upload/drain delta, not a mixed-in shape/reconnect review.The workspace is a frozen review snapshot. I’ll read the grok prompt, prior-grok notes, and the governing 1006/1012/1002 contracts next, and skip other-family review files.Prior grok was READY on an earlier JS-only successor. I’ll load this revision’s patch and the 1006/1012/1002 contracts, then trace the actual helper callers.The patch is JS-only plus three contract nips. Next I’ll read the rest of it and the live helper paths those nips actually bind.I’ll read the live client, wire, upload, and outbox helpers next so I can check the claimed boundary against actual callers, not just the patch hunks.I’ll check owner 401 mapping, json() callers, and the new tests so abort-vs-terminal ordering is verified on the real paths, not the claimed shape.Checking one FIFO caller interaction so the sealed-store finding is grounded in the actual `enqueue`/`get` unsealed guards.## Verdict: **CHANGES_REQUIRED**

Source review of immutable Snapback2 `9b0c74269a34dc2b9ea2023d77fe748486869c1e` vs `617f61b4d` (`revision.patch` only). I did not run tests, did not use the network, did not read other-family reviews, and did not treat prior-Grok READY as execution proof. Scope is this response/lifecycle delta; shape/reconnect work is not in the snapshot.

The coherent boundary is real: raw 4xx is parsed before the authority fence, named `JsonRequestOptions` keeps `onSend` at dispatch, expiry aborts sibling drains without aborting the origin signal, and the **post-enqueue** sealed-store guard preserves originating `E_AUTH_SESSION`. One same-class hole in the function they just patched still replaces that terminal with a carrier lifecycle error.

---

### Claimed repairs that hold on the changed paths

**Raw validator before suppression.** `checkedAssetResponse` parses 4xx via `responseRefusal` before `ensureAuthority`. Fetch uploads, native Expo upload, and XHR all enter it. Upload/XHR pass `afterCleanup: true` so sibling discard still precedes expiry; `assetBlob`/`assetBytes` do not, so a 401 expires immediately. XHR `onload` no longer fences before the 401 body is read — that is the prior “fenced 401 never expires captured custody” hole.

**Late successful bodies.** Uncached `assetBlob`/`assetBytes` read `blob()` / `arrayBuffer()` first, then `throwIfAborted` + `validated`/`ensureAuthority`. `uploadPrepared` rechecks authority after both failed and successful `response.json()`. Login waits on `trackWrite` for uploads; asset reads are untracked and the post-body check is what stops predecessor bytes from returning.

**Named JSON options / `onSend`.** Mutation submit is `{ terminalSession: "after-cleanup", onSend }` with `onSend` invoked immediately before `fetchImpl`. Login/logout use `{ enforceAuthority: false, terminalSession: "keep" }`. `me()` is `{ authRestoration: true }` (default expire). No leftover positional booleans. Drain/resume stay 3-arg on purpose (intents already durable).

**Origin vs sibling abort.** `expireSession` calls `abortSync(options.signal)`. Drain/resume `json` wrappers pass their controller signal through `init.signal`, so the request that observed the 401 is excluded and still throws `E_AUTH_SESSION`. Other drain controllers abort. `drainNow` still lends captured authority (no wait on `operationAuthority` behind a transition waiting on that write). Durable intents are not settled on abort; recovery retries the same envelope.

**Post-enqueue sealed read.** After this call has an outbox entry, a terminal drain error is rethrown instead of `outbox.get`. Owner `E_AUTH_SESSION` is HTTP 401 (`serve.rs` `refusal_status`), so replay/tail terminals go through that json 4xx path, not a 200 rejected receipt.

**Successors.** `expireSession` still no-ops unless `currentToken` and `custodyGeneration` match. `terminalRefusal` with `preserveOutcome` keeps mutation 401 after json already expired. Tests for failed vs successful replacement match the fence: captured `save(null)` can still run while login is in `settleWrites`; successor token is not cleared.

Cleanup ordering for **this call’s** 401 is unchanged: automatic mutation 401 is `after-cleanup` then discard then `terminalRefusal`; first-file/direct upload 401 is `afterCleanup` then `upload()` `terminalRefusal`; mutation-owned drain of **this** intent is outbox custody, so bytes are retained.

---

### Blocking: FIFO pre-enqueue catch still walks the sealed store

`submitMutation` now preserves originating terminal **only after this intent exists**. The FIFO catch above it still swallows every drain error, including `E_AUTH_SESSION`, then writes the store:

```103:114:snapback2/packages/snapback2/src/client-outbox.ts
  if ((await runtime.queuedIntents()).length > 0) {
    let stopped = true;
    try {
      ({ stopped } = await options.drain());
    } catch {
      stopped = true;
    }
    if (stopped) return queued(await enqueue());
  }
```

**Counterexample (changed path, not a new arm):** partition open, at least one intent already `queued`, caller submits another `mutation()`. `drainNow` replays the older envelope, owner returns HTTP 401 `E_AUTH_SESSION`. Drain json uses default `terminalSession: "expire"`, so `expireSession` seals the partition, records the 401, and throws it. That drain **is** this call’s `options.drain()` — the request that observed the terminal. The new catch swallows it.

`enqueue()` then hits `store.outbox.grant()` → `ensureUnsealed()` → `OfflineStoreFailure("range store is sealed")`. `failure()` maps that to `E_OFFLINE_LIFECYCLE`. `onCustody` has not run, so `withMutationUploads` treats custody as unset, discards (best-effort, already fenced), and **`recordRefusal` of the lifecycle envelope overwrites `lastRefusal`**. Mutation catch does not see a terminal session, so it does not `terminalRefusal`.

**Impact:** the caller gets `E_OFFLINE_LIFECYCLE` (“authenticate to unseal”) instead of `E_AUTH_SESSION`. Snapshot `lastRefusal` can follow the carrier error. Session **is** already cleared; the durable older intent stays queued. This is the same class as the patch comment on the next catch (“Session expiry sealed the store; preserve its refusal instead of reading through that seal”), in the same function, on the FIFO path that comment says exists so a later write queues behind.

The new replay/tail origin tests start from `outbox.settled()` (empty queue), so they only exercise the post-enqueue catch.

**What would resolve it:** in that first `catch`, rethrow when `isSnapbackRefusal(error) && isTerminalSession(error.envelope)` — the same guard as lines 123–124 — and do not `enqueue()`. Session death is not “an older intent’s own refusal.” A transport/fence stop can still queue behind.

---

### Optional (nonblocking)

- **Same post-enqueue catch still `outbox.get`s on `AbortError`.** A sibling drain aborted by someone else’s expiry can lose the race to `seal()` and surface `E_OFFLINE_LIFECYCLE` instead of `AbortError`. Origin 401 is protected; the intent stays queued; recovery still retries. Not required for this verdict.
- **Two spellings of deferred expiry** (`terminalSession: "after-cleanup"` on json vs `afterCleanup` on raw). Behavior is consistent; drain remaining on default expire is the prior reviewed choice, not a new defect.

---

No other CHANGES_REQUIRED in this snapshot. I did not run the reported 27 new cases / package suites; those counts are not this review’s proof.
