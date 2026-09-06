I'll start with the review skill and the snapshot's `revision.patch` plus any prior grok notes, then read only the auth-revision source, tests, and LLP 1002/1012 that the patch actually touches.This is a read-only independent review of the auth revision, not a source edit. I’ll start from `revision.patch` and `prior-grok.md`, then only the source, tests, and LLP 1002/1012 the patch actually needs.Prior grok review left READY with optional coverage on drain/parse abort. I’ll read `revision.patch` first, then the surrounding source and tests for those two cancellation paths.I'll read the patched client paths, `withAbort`, drain/outbox, and the LLP sections those comments cite.Checking one remaining interaction: `confirmAuth` after a late `me()` body, and whether a 5xx/ensureAuthority path can still write after parse.**READY**

Read-only review of `9b22e7b48` vs `0e6cebfcd` (full patch against `30e4707ce`). I did not run tests, edit the tree, touch the network, or read the other reviewer file. Nine new regressions and 181 affected / build / caps / refs are taken as reported.

The prior resumeTail hang stays fixed. This revision closes the two leftover transport-wait holes: a held outbox drain no longer pins `drainTail` after abort, and a cancelled resume can finish parsing a 401 or broken JSON without clearing recovered custody or writing `lastRefusal`.

---

## Drain unwind (`drainTail`)

`performResume` already races the whole `resumeOffline` flight (`client.ts:1106`). That wakes `resumeTail` waiters, but `drainOutbox` serializes on `runtime.drainTail` (`client-outbox.ts:159-162`). While `drainQueued` is inside `options.json(...)` (`client-outbox.ts:189`, log-tail at `:281`), `throwIfAborted` does not run, so a fetch that ignores abort left the successor drain chained behind the obsolete request.

The resume-owned `json` helper now races every resume transport await:

```1142:1147:snapback2/packages/snapback2/src/client.ts
    const json = async (path: string, init: RequestInit) => {
      check();
      // @ref LLP 1012#7-writes-offline — release the serialized drain even if replay or its tail ignores abort.
      const value = await withAbort(signal, () => this.json(path, { ...init, signal }, authority));
      check();
      return value;
    };
```

That helper is what `performOfflineResume` and `drainOutbox` use (`client-offline.ts:403`, `:485`, `:509`). Abort rejects the in-flight replay or tail immediately; `drainTail` swallows (`client-outbox.ts:162`); replacement `drainOutbox` is not stuck on the old body.

**FIFO / exactly-once.** `queued()` is `outboxOrder` (`range-store.ts:589-591`). `replayEnvelope` is byte-stable (`store/outbox.ts:388-406`). Abort during replay throws `AbortError`, which is not a Snapback refusal, so `drainQueued` does not `finish("transport")` and does not `settle` the intent (`client-outbox.ts:190-201`). The durable row stays `queued`. The next drain retries that same envelope first. The owner ledger answers a second execute as already stored (`fake-owner.ts:181-197`). Reported pins: 3 stages × `{offline, failed-login}` in `auth-restoration.test.ts:1102-1165`.

**Replacement barrier.** `offline()` then `online()` still publishes via `setResume` (`client-offline.ts:282-284`). Failed login still publishes `resumeAfterAuth` after `transitionTail` (`client.ts:729-737`, `:1308`). Waiters still recheck `resume === this.resumeTail` (`client.ts:1259-1266`). The new work is that those waiters are no longer queued behind an obsolete drain.

**Late cancelled replay.** Inner `this.json` keeps running after `withAbort` loses. Held fetch hits `throwIfAborted` at `client.ts:868`; held success body at `:926`. `settle` / `commitMany` never see the late value, so the obsolete drain cannot mark committed or issue another `/api/mutation` (`replays.length` frozen after release).

---

## Delayed resume bodies (401 / malformed JSON)

`json()` already aborted after fetch (`client.ts:868`) and after a successful 200 parse (`:926`). Abort *during* `response.json()` still passed those checks, then:

- 401 `E_AUTH_SESSION` called `expireSession` for the captured bearer. `offline()` / `online()` does not bump `operationFence` or rotate the token (`client.ts:595-600`), so `expireSession`’s custody check (`:1315-1316`) would still match, seal the recovered partition, and clear the bearer.
- Malformed 4xx became retryable `E_TRANSPORT` and patched `connection` / `lastRefusal` (`:874-884`).
- Malformed 200 recorded `wireShape` (`:918-924`).

Post-parse fences:

```874:887:snapback2/packages/snapback2/src/client.ts
        } catch (error) {
          throwIfAborted(init.signal);
          // ...
        }
        // @ref LLP 1002#9 — me() retains late terminal evidence across cancellation.
        if (!authRestoration) throwIfAborted(init.signal);
```

and the same abort check in the 200 parse `catch` (`client.ts:918-919`). Resume uses default `authRestoration = false`, so a cancelled `/api/resume` cannot `expireSession`, `recordRefusal`, or seal. `performResume`’s error arm still no-ops when `controller.signal.aborted` (`client.ts:1115-1118`). Reported pins: `auth-restoration.test.ts:1167-1218` (`terminal-refusal`, `invalid-refusal-json`, `invalid-success-json`).

---

## Deliberate late-`me()` evidence

Only `confirmAuth` passes `authRestoration = true` (`client.ts:743`). That path still skips the post-parse abort check so a valid 401 can run `expireSession` against captured custody (`:887-891`). Failed replacement still holding Alice’s bearer clears it; Bob’s installed token does not. Malformed 401 is not evidence: the `catch` abort check is unconditional, so cancelled `me()` does not record `E_TRANSPORT`.

`confirm()` increments `epoch` on suspend, so `failed()` does not run on the superseded flight (`client-auth.ts:231-233`). Anonymous after a failed login during hydrating `me()` still comes from this expire, not from the failed login restore. The existing test now also holds the 401 body (`auth-restoration.test.ts:267-293`).

---

## Optional coverage (not CHANGES_REQUIRED)

- Delayed resume 401 / malformed JSON is pinned on `offline()` → `online()`, not failed-login. Failed-login uses the same `json()` fences and the same remaining Alice bearer; it is the same code, not a second pin.
- Drain waiters are still mutation + `online()`, not `subscribe` / `me()`. Those four still share `operationAuthority({ waitForResume: true })`.
- Abort during `commitMany` after `json()` has already returned is local store I/O. `drainTail` stays serial; `throwIfAborted` before the next intent still stops the obsolete drain. Not the ignore-abort fetch case.
- Cancelled `me()` with malformed 401 is the unconditional `catch` path, not a dedicated case in the late-evidence loop.

**READY.** Cancellation releases replay and log-tail waits inside the serialized drain; replacement recovery retries the exact committed envelope before later intents; the ledger remains exactly-once; late cancelled resume parse cannot clear captured custody, seal, or write snapshot/outbox; valid late `me()` 401 still expires only the bearer that still holds that token.
