# LLP 1018 move one — client lane review (grok)

**Change:** `s2/clique-client-sessions` — shared query entries and the browser follower tab. Round 1 reviewed commit `703425379`; round 2 reviews the fix delta `c8b7f1c1c` (appended when received).
**Reviewer:** Grok 4.6, reasoning xhigh, `--permission-mode auto --no-subagents --no-memory`, blind.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Landed:** the lane's commits cited below were rebased at landing; on `main` they are `6b9a31278..e980f3450` (feat plus five fix rounds), the same content.
**Provenance:** every review below was actually received from the named model; verbatim text per round. The two reviewers never saw each other's reviews. Fix rounds were implemented by the orchestrator (the lane's implementer).

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | 703425379 (the slice) | VERDICT: NOT READY (4 MATERIAL) |
| 2 | c8b7f1c1c (fix round 1 delta) | VERDICT: NOT READY (1 MATERIAL) |
| 3 | d66c38a6e (fix round 2 delta; read while 8dce9f0e6 landed) | VERDICT: NOT READY (1 MATERIAL) |
| 5 | a11b81128 (fix rounds 3–4 delta) | VERDICT: NOT READY (1 MATERIAL) — the finding is the drain-tail terminal refusal, fixed in 125ec3023 with a test (codex round 6 confirms) |

## Round 1 (verbatim)

## MATERIAL

**1. Shared `last` is not cleared when the underlying stream `reset()`s — a late consumer is replayed a delivery the new stream has discarded.**

`snapback2/packages/snapback2/src/client-sessions.ts:34` stores `last` on the shared entry. `attach` replays it at `client-sessions.ts:47`. Resume rebuild calls `reset()` on the **tracked underlying** SSE, not on the wrapper:

```409:411:snapback2/packages/snapback2/src/client-offline.ts
    for (const subscription of [...options.subscriptions]) {
      (subscription as Subscription<unknown> & { reset?: () => void }).reset?.();
    }
```

`ReconnectingSse.reset()` clears the SSE’s own `last` and starts a successor “with no predecessor event id or answer.” The shared entry is not in that set, `authGeneration` does not bump, and `SharedSubscriptions.clear()` is not called. A component that attaches after program rotation is handed the pre-reset page; a fresh per-consumer stream would have shown nothing until the successor delivery. Keying by `authGeneration` is sufficient for login/logout (`closeTransports` + increment) and **not** for reset.

**2. A follower still sends write bytes: the `E_OFFLINE_FOLLOWER` fence is only inside `submitMutation`.**

The commit and LLP 1018 §3 require every write to refuse **before any bytes leave**. The check is only at `client-outbox.ts:91`.

- `client.ts:289-296` — `withMutationUploads` uploads asset bytes, then `submitMutation` throws. Clique image sends leave the tab.
- `client.ts:328-333` — `upload()` has no fence.
- `client.ts:339-341` — `discardUpload()` has no fence.
- `client-channels.ts:36-54` — `channel.publish` POSTs `/api/channel/.../publish` with no fence.

`outbox.drain()` is not this bug: with `principal === undefined`, `drainQueued` returns without HTTP.

**3. `restart()` does not withdraw the follower wait — a discarded client can steal the writer lock and never release it.**

`close()` and sign-out abort the wait (`client.ts:617`, `client.ts:1069`). `restart()`’s shutdown does not:

```576:586:snapback2/packages/snapback2/src/client.ts
      shutdown: async () => {
        this.closed = true;
        this.lifetimeController.abort();
        this.authState.stop();
        this.abortSync();
        this.operationFence += 1;
        this.closeTransports();
        this.patchSnapshot({ connection: "offline" });
        await this.offlineRuntime?.close();
      },
```

Follow uses its **own** `AbortController`, not `lifetimeController`. A waiting Web Lock request therefore survives shutdown. When the writer releases:

1. The dead client’s `acquire` resolves (`signal` never aborted).
2. `offline.ts:273-278` opens the partition and holds the lock.
3. `client.ts:1030` sees `this.closed` and returns **without** `store.close()`.
4. The replacement client hits `E_OFFLINE_LOCK` and waits forever on a holder that will not release until the document dies.

That is exactly the “discarded follower can never steal a lock later” rule.

**4. Token restoration on an already-following tab throws `E_OFFLINE_LOCK` and never authenticates.**

```1017:1020:snapback2/packages/snapback2/src/client.ts
      if (code === "E_OFFLINE_LOCK" && this.offlineRuntime.canFollow && !this.following) {
        this.follow(principal, authenticated, authEpoch);
        return;
      }
```

Hydrate already called `follow(..., authenticated=false)`. `confirmAuth` then calls `openOffline(viewer, true, epoch)` for the **same** principal. `this.following` is set, so the second `E_OFFLINE_LOCK` is not converted to follow; it is thrown. `ClientAuth.confirm` marks auth `refused` with `E_OFFLINE_LOCK`. Persona tests hide this (`as:` skips confirm). A bearer second tab — Clique on React web — never reaches `authenticated`, so any UI gated on that state never mounts the live reads the policy promises. Takeover also never sees `authenticated`/`authEpoch` from confirm, so it will not `reauthenticate` after inherit.

## MINOR

**Replay is not identity-guarded.** `client-sessions.ts:47` replays a snapshot of `last` on a microtask. If a newer fan-out runs after `attach` and before that microtask, the late consumer sees new then old. Typical SSE delivery is a later task, so this is a narrow race; after reset (finding 1) it is not.

**Abort-at-grant can hang `acquireLock`.** `indexeddb.ts:231`: if the callback runs with `signal.aborted`, it returns without `acquiredResolve`/`acquiredReject`. `request` fulfills, so `request.catch` does not fire, and `await acquired` never completes. `releaseHeldLock` cannot unstick it (`lockRequest` is assigned only after `acquired`). Real Web Locks usually refuse to invoke the callback when the signal is already aborted; the gap is the grant/abort overlap.

**Takeover is not fenced once `this.following` is cleared.** `client.ts:1031` nulls the handle, then awaits `reauthenticate`/`takeover`. A concurrent `openOffline` of another principal no longer calls `stopFollowing`. `reauthenticate` will throw if the partition already changed; the failure is recorded as `RangeStore.open` rather than dropped.

**`PersistentRangeStore.acquire` bypasses the store queue** (`range-store.ts:651`). `open`/`close`/`wipe` are enqueued; lock wait is not. `follow` checks `signal.aborted` between acquire and open (`offline.ts:274-278`), which covers the close path that *does* abort. It does not cover restart (finding 3).

## REFUTED-RISK

**Stale replay after auth change / session refusal.** `closeTransports` (`client.ts:1417-1422`) `shared.clear()`s then closes underlyings; `expireSession`/`transition` then bump `authGeneration`. A later `subscribe` cannot attach to the old `last`. A terminal refusal replayed to a late consumer of a **still-held** entry is the shared current delivery; a subscribe after the last close opens a new stream.

**Dead-entry reuse after `closeTransports`.** `clear()` drops the map before underlyings are closed. The next `attach` of that key cannot revive a closed SSE. `reset()` on resume does not close the underlying (finding 1 is stale `last`, not a dead entry).

**`commitMany` no-op dropping a live delivery.** `offline.ts:543-546` returns `false` for a follower; `decodeOfflineSubscription` still returns the wire value to the callback. The writer tab owns durability; inherit + resume fills the store. This is the one-writer contract, not a dropped frame.

**`reauthenticate` before `takeover`.** Follow’s `open(principal)` does not unseal. `reauthenticate` then `ensureOfflineMetadata`/`performResume`/`drainNow` is the right order when `authenticated` is actually true (finding 4 is why token tabs never pass that flag).

**`outbox.drain` / live `query` as follower writes.** Drain with no partition is a no-op. Query is a live read (allowed). SQLite still has no `acquire`, so `canFollow` is false and a second native client still refuses at once.

**`inProcessLocks` waiter queue.** Holder handoff uses a fresh token (`locks.ts:44, 68-69`); the previous holder’s `finally` no-ops. Cancel while queued only filters `waiters`. Abort after grant is not supposed to steal the lock (Web Locks). `ifAvailable` still answers `null` at once.

**`releaseHeldLock` deadlock on the happy path.** The callback awaits `released`; `releaseHeldLock` (`indexeddb.ts:204-211`) resolves that first, then awaits `request`. The lock manager can see the release before the next `request`. The hang above is the aborted-callback case, not this await.

**`partition` set only after `backend.open`.** A refused lock no longer leaves `PersistentRangeStore` “open” for the same principal (`range-store.ts:661-665`), which is why a later open retries. `unseal`/`seal`/`commit` go through `ensureOpen()`. Follower `wipe`/`seal` no-op while `runtime.partition` is unset, so sign-out does not touch the writer’s database.

**Retained state / budget.** One `last` per shared key is the delivery the stream already held; follower waiters are transient. +203 gzip on the boundary roots is the claimed cost. No extra retained copy of coverage.

---

`authGeneration` is the right key for authority transitions. It is not a substitute for clearing shared `last` on `reset()`. The follower fence has to sit in front of **every** write helper, and the wait has to die on every client teardown, including `restart()`.

VERDICT: NOT READY (4 MATERIAL)

## Round 2 (verbatim)

## Round-1 disposition

| Round-1 finding | Status |
|---|---|
| Stale replay after reset | **Closed.** `reset` clears `entry.last` before the stream resets (`client-sessions.ts:50-54`); the microtask recaptures `last` at fire time (`:64-69`). |
| Refcount by callback identity | **Closed.** Each `attach` is its own `Attachment` object (`:59-60`, `:76`). |
| Regular/drain mounted records overwriting | **Closed.** Live key is `op\0live\0args` (`client.ts:390`); drain key is `op\0drain\0args` (`client-offline.ts:219`). |
| Write fence after uploads; missing upload / discardUpload / channel.publish | **Closed.** Fence is the first line of `trackWrite` (`client.ts:1393-1395`); mutation, upload, discardUpload, and channel publish all go through it. |
| Restored bearer second tab reopening the same principal | **Closed** for the double-open-while-waiting case. `confirm` keeps the wait and records the epoch (`client-sessions.ts:138-142`; test at `client-sessions.test.ts:208-232`). |
| Runtime keeping the old principal on account switch | **Closed.** Partition is named `undefined` before the new open (`offline.ts:308-312`). |
| Follower drains reading the unopened ledger | **Mostly closed** on the subscribe path (manifest cursor, no `drainCursor`, mark no-op). Residual in `answerOffline` below. |
| `restart()` / session expiry leaving the wait alive | **Closed** for a still-queued wait (`client.ts:588`, `:1306`). |
| Queued lock request not cancellable by close | **Closed.** `pendingAbort` is aborted from `releaseHeldLock` (`indexeddb.ts:207-208`, `:228-233`). |
| Follower marker clearing before takeover finished | **Happy path closed** (`followed()` moved to after reauth+resume). **Not closed** for a superseded continuation (MATERIAL below). |
| Abort-at-grant hang | **Closed.** Granted+aborted rejects `acquired` and returns without holding (`indexeddb.ts:242-246`). |
| Replay not identity-guarded | **Closed.** Replay checks `attachments.has(attachment)` (`client-sessions.ts:65`). |
| Replay callbacks not isolated | **Closed.** Replay is in `try/catch` (`:69`). |

## MATERIAL

**1. A superseded `follow()` still calls `followed()`, which drops the write fence of a newer wait.**

`HEAD~1` cleared the marker only when it still named *this* principal:

```javascript
} finally {
  if (this.followingPrincipal === principal) this.followingPrincipal = undefined;
}
```

The rewrite lost that guard. Three sites now clear whatever marker is current:

```154:161:snapback2/packages/snapback2/src/client-sessions.ts
      if (this.wait === wait) this.wait = undefined;
      runtime.followed();
      this.host.drain(authority);
    }).catch((error) => {
      if (this.wait === wait) this.wait = undefined;
      runtime.followed();
      if (wait.controller.signal.aborted || this.host.closed()) return;
```

```279:281:snapback2/packages/snapback2/src/offline.ts
    } catch (error) {
      this.followed();
      throw error;
```

`this.wait === wait` only decides whether to forget the wait object. `followed()` / `drain()` always run.

The client now *starts* a second follow after an account switch (`client.ts:1025` dropped `&& !this.following`; `confirm` aborts the old wait and falls through to `begin`). Concrete sequence:

1. Tab is following alice (writer still open, or takeover already past the abort check at `:150`).
2. Same tab logs in as bob, whose writer lock is also held. `confirm` aborts alice, `open(bob)` throws `E_OFFLINE_LOCK`, `begin(bob)` sets `followingPrincipal = bob`.
3. Alice’s `follow()` then rejects (or its `then` finishes). `followed()` sets `followingPrincipal = undefined`.
4. `trackWrite` and `submitMutation` no longer refuse. This tab can send bob-bytes (or enqueue onto whatever partition is still open) ahead of bob’s writer queue — the inversion LLP 1018 moved the fence to prevent.

The success path is not hypothetical timing on `AbortSignal`: after the writer closes, `:150` has already passed, and `reauthenticate` / `takeover` await the network. A login in that window is a user-scale race. `followed()` then unfences while `begin(bob)` is still waiting.

**Fix:** `followed()` (and `drain`) only if this wait is still current *and* `followingPrincipal === principal`. On a superseded success path, `store.close()` so the granted lock is not held by a continuation that is no longer the wait. After every `await` in `then`, re-check abort / `this.wait === wait` before touching the marker.

## MINOR

**1. `answerOffline` still admits a drain against the unopened ledger.** `client.ts:227-228` and `client-offline.ts:232` skip `drainCursor` / mark when `following`, but:

```193:193:snapback2/packages/snapback2/src/client-offline.ts
    if (drain) runtime?.drainCursor(op);
```

A follower drain tail that retries offline (`subscribeRegular` `onError` passes `drain=true` into `answerOffline`, `client.ts:445-450`) calls `admitDrain` with no `held` contract and throws `E_OFFLINE_RESUME` / `unsupported-log`. That can kill the tail (`sse.ts:233` has no `try` around `onError`). Same hole for a still-hydrating bearer `query(..., true)` after `ready` (`client.ts:229-233`: `startupComplete` is true). The added drain test uses a persona client, so it never enters this branch.

**2. `confirm` during an unauthenticated takeover records the epoch and then ignores it.** Hydrate `begin`s with `authenticated=false`. If the writer closes before `me()` and `confirm` runs *during* `takeover()` (`:153`), `wait` is still set so `confirm` returns true and skips `reauthenticate` (`client.ts:1012`), while `then` already skipped it because `wait.authenticated` was false at `:152`. The epoch sits on a wait that is about to be cleared. Narrower than (1); the added bearer test keeps the writer open until after authentication.

## REFUTED-RISK

- **Post-grant `expireSession` / `wipe` leaving the lock held.** Once `acquire` succeeds this tab *is* the writer. `wipe` is `serial()`-queued behind `follow()`’s `open()`, so sign-out still sees `partition` set and wipes/releases. `close` / `restart` still `runtime.close()`. Holding the lock across a 401 after grant matches a writer tab expiring.
- **Shared-entry replay / StrictMode / reset.** Attachment identity, late recapture of `last`, reset hook, and isolated replay callbacks hold up. Two subscribers sharing one function are two consumers (test at `client-sessions.test.ts:163-185`).

VERDICT: NOT READY (1 MATERIAL)

## Round 3 (verbatim)

### MATERIAL

**Withdrawn wait’s give-back close still aborts a newer wait’s acquire** — `offline.ts:277`

Item (a) is only half-fixed. `followed(principal)` no longer clears a newer account’s marker, but the new “granted after withdrawn” path still calls `this.store.close()` whenever `this.partition === undefined`. IndexedDB `close` → `releaseHeldLock` (`store/indexeddb.ts:207-208`) aborts `pendingAbort`, which is **whoever is currently waiting**, not the wait that just gave the lock back.

Reachable interleaving:

1. Wait A is granted, then withdrawn; `follow` enqueues the serial close.
2. `openOffline(B)` is already on the serial queue (`client.ts:1015`). `ifAvailable` fails (`E_OFFLINE_LOCK`); `begin(B)` starts `follow`/`acquire` (`client.ts:1026`).
3. `serial` attaches the close *after* that `open` (`offline.ts:862-863`: `tail = run.then(noop)` first, caller second, next `serial` after the noop). `begin(B)` therefore runs, and B’s `acquireLock` sets `pendingAbort`, before A’s close.
4. A’s close aborts B’s lock request. B’s `wait.controller` was **not** aborted, so `TabFollower`’s catch calls `host.failed` (`client-sessions.ts:178-179`) instead of treating it as a withdrawn wait.

Switching to another account that is already locked in another tab, at the moment this tab is granted the previous account’s lock, fails the new follow instead of waiting, and drops B’s fence via `followed(B)` in `follow`’s catch (`offline.ts:282`). The partition check only skips the close once a later `open` has set `this.partition`; it does not cover a newer wait still in `acquire`.

Give back only the held lock (do not abort `pendingAbort` / do not `store.close()` the carrier), or skip the close when another wait is already following.

---

### MINOR

**`followed` is keyed by principal, not by wait** — `offline.ts:289-291`, `client-sessions.ts:177`

`current()` uses wait identity; `followed` uses the principal string. A withdrawn wait for Alice can still clear a later Alice wait if its `followed(Alice)` runs after the new `follow` has set the marker. `openOffline` currently `stop()`s before a second `begin`, so this is hardening, not a demonstrated Client path.

**Drain shared entries still miss `except`** — `client-sessions.ts:104`

Live origin matches (`entry.underlying` is the `ReconnectingSse` passed to `expireSession`). A drain’s underlying is the `DrainSubscription`; the tail SSE is `except`. Drain consumers can still be detached. Pre-existing shape; this delta only fixes the live identity.

**No new tests for the races this commit claims to close** — `tests/client-sessions.test.ts`

The only test edits loosen the shared-callback assertion and rename the follower-drain test. Nothing covers superseded-wait fence, confirm-after-inherit, abort-after-grant, or terminal refusal through a shared live entry.

---

### REFUTED-RISK

**Keep the follower fence when takeover resume fails retryably** — `client.ts:1034-1043`, `client-sessions.ts:170-174`

Rejected. After acquisition the tab holds the writer lock and an open partition. Swallowing retryable / `E_OFFLINE_RESUME` / `E_OFFLINE_RESET` and then `followed()` is the same posture as a cold-start writer: writes enqueue FIFO behind inherited intents; `drainNow` is the replay. Holding the fence would refuse writes the writer is allowed to queue.

---

VERDICT: NOT READY (1 MATERIAL)

## Round 5 (verbatim)

## MATERIAL

**Drain-originated terminal refusal still never reaches that drain’s consumers.** `SharedSubscriptions.clear` now spares an entry when `DrainSubscription.owns(except)` (`client-sessions.ts:105`), but `closeTransports` still closes every tracked subscription that is not the tail itself (`client.ts:1409–1410`). A shared drain is opened as `this.drain(...)` (`client.ts:378`), tracked as the `DrainSubscription` (`client-offline.ts:256`), and its tail is a separate `subscribeRegular` object passed as `origin`. The loop therefore closes the drain. `DrainSubscription.close` then closes that same tail and fails waiters with `AbortError` (`drain.ts:37–43`) — synchronously, at the start of `expireSession` (`client.ts:1311`), while `ReconnectingSse` is still inside `onError`. After `onError` returns, the tail is already `closed` and does not `deliver` the refused event (`sse.ts:233–236`). Shared `until()` is `underlying.until` (`client-sessions.ts:82`), so consumers get `AbortError` instead of `E_AUTH_SESSION`. `owns()` does not change that outcome. The new test (`client-sessions.test.ts:235`) uses a live subscribe, not `{ drain: true }`, so it only re-proves the round-2 identity `except` path.

The missing dual of `owns()` is to skip the same drain in the `closeTransports` loop (and not let `DrainSubscription.close` kill the excepted tail) so `onError` can still deliver `refused` into the spared fan-out.

## MINOR

None beyond the test gap already in the MATERIAL finding.

## REFUTED-RISK

- **Same-principal ABA on the follower marker.** `follow(..., wait)` stores `followingWait`; `followed(wait)` is a no-op unless the wait object matches (`offline.ts:271–272, 292–296`; `client-sessions.ts:166–179`). A withdrawn wait cannot unfence a later wait for the same principal. The chat map naming `follower` (`templates/chat/shared/offline.ts:21`) matches `OutboxStatus.reason`.
- **Withdrawn grant aborting a newer wait’s queued lock.** `giveBack(partition)` releases only when `lockedPartition === partition` and `this.database` is unset, and it does not abort `pendingAbort` (`indexeddb.ts:114–122`). That is the opposite of `releaseHeldLock` (`indexeddb.ts:217–218`) / `store.close()`. A newer wait’s queued request and a partition an open has taken are left alone.

VERDICT: NOT READY (1 MATERIAL)
