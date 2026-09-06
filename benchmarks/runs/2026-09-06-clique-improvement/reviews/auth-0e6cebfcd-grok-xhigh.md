I'll start with the review skill and the snapshot's prior-grok notes, then inspect the auth-r3 diff and the cancellation/fencing code it actually landed.This is a direct independent review, not the `/review` orchestrator. I'll read `grok-prompt.md`, `prior-grok.md`, and the patches, and skip other reviewer files.Prior grok finding is loaded: abandoned `resumeTail` still gated waiters. Next I’ll read both patches and the current lifecycle code.The revision installs `withAbort` and a synchronous `resumeTail`. I'll read the final lifecycle code and the tests that pin those paths.The abort wake path looks plausible; I’ll read `goOnline`/`initializeOffline` and the restoration tests next to check waiter publication and late-response fencing.Late-response fencing in `json()` looks intact. I'll inspect `operationAuthority` join logic, `abortResume` publication, and the rest of the client auth changes.**READY**

Read-only review of `0e6cebfcd` against `30e4707ce` (revision from the tree that left `resumeTail` bound to an abandoned flight). I did not run tests, edit the tree, touch the network, or read the other reviewer file. 173 affected tests are taken as reported; I did not verify them here.

The prior material finding is actually fixed in this tree. Cancellation wakes captured waiters even when fetch ignores abort; replacement recovery is published as the barrier before those waiters dispatch; late cancelled `/api/resume` bodies cannot change custody, connection, `lastRefusal`, or the settled outbox on the pinned paths.

---

## Prior material finding

### Abandoned `resumeTail` still gated mutations, live `open()`, `online()`, and `me()` — resolved

Three changes close the ignore-abort stall:

1. **`withAbort` is the cancellation barrier** (`client-wire.ts:323-332`, used at `client.ts:1102`). `abortResume()` still only aborts the controller and drops `resumeFlight` (`client.ts:1129-1133`). That is enough: `Promise.race` rejects on `abort` even if `resumeOffline`’s fetch never settles. The outer `resumeTail` wrappers swallow that rejection (`resumeAfterAuth` `.catch(() => undefined)` at `client.ts:737`; `goOnline` `setResume(run.then(() => undefined, () => undefined))` at `client-offline.ts:284`), so waiters do not see `AbortError`.

2. **Replacement publication is synchronous.** `resumeAfterAuth()` assigns `resumeTail` to the whole `operationAuthority(false).then(performResume)` chain before any await (`client.ts:733-737`). It is no longer installed only inside the `.then` after the wait.

3. **Old captured waiters recheck identity.** `operationAuthority` snapshots `resume`, awaits it, then returns only if authority is still current **and** `resume === this.resumeTail` (`client.ts:1254-1261`). A waiter that captured the cancelled flight cannot dispatch on a successor barrier.

**Failed-login interleaving (the prior hang)**

1. Cold client, queued outbox, Alice token. `login(alice)` publishes `resumeTail` and holds `/api/resume`.
2. `mutation(...)` is in `operationAuthority` awaiting that tail (`client.ts:283`, `:1258-1259`).
3. `login(wrong)` enters `transition()`: `operationFence++`, `abortResume()` (`client.ts:1269-1273`). `withAbort` fulfills the captured tail. The waiter’s authority is stale, so it loops into `transitionAuthority` and waits on the failed login.
4. On `run` rejection, handlers run in attachment order: `transitionTail` fulfills, then `run.catch(() => this.resumeAfterAuth())` (`client.ts:1302-1303`) assigns the replacement tail, then the login promise rejects. The waiter of `transitionTail` is queued only after that fulfillment, so it captures the **new** tail, not the cancelled one.
5. The waiter stays on the replacement `/api/resume`. A late body on the old fetch hits `throwIfAborted` in `json()` before parse, `expireSession`, `recordRefusal`, or `patchSnapshot` (`client.ts:868`, `:938`). `performResume`’s error arm publishes `lastRefusal` only when `!controller.signal.aborted && authorityCurrent` (`client.ts:1111-1114`).

The new test `failed-login wakes recovery waiters before an obsolete transport responds` (`auth-restoration.test.ts:1038-1093`) holds that mutation through cancellation, requires `resumes === 2` and `waiterDone === false` until the **new** body, then pins snapshot and outbox against the late old body.

**`offline` then `online()`** is the other arm of the same test: `offline()` aborts without a fence bump; `withAbort` releases the old tail; `online()` starts a new flight and waits on `run` (`client-offline.ts:283-286`). A late `E_AUTH_SESSION` on the cancelled fetch cannot expire the still-current bearer because abort is checked before the 4xx arm (`client.ts:868` before `:887-888`). Authority fencing alone would not have been enough here (`offline()` does not bump `operationFence`).

Startup cuts still release `ready` via `initializeOffline`’s race (`client-auth.ts:149-169`) and abort the resume controller from `transition()` (`client.ts:1270-1273`). The four `login cuts pending initial {manifest,resume}` cases remain the pin.

Queued-successor, failed-login recovery restart, metadata-not-skipping-resume, held one-shot/live reads, and past-fence re-login are unchanged and still match the code.

---

## Optional coverage (not CHANGES_REQUIRED)

- **Throw-once on a held carrier read.** `query()` still throws `E_AUTH_SUPERSEDED` if a transition starts during `answerOffline` (`client.ts:222-223`). Pinned (`auth-restoration.test.ts:1006-1036`). Spec requires a post-read authority check, not wait-again.
- **Live hydrating shortcut on that same I/O window.** `ensureAuthority` throw is swallowed (`client.ts:480`). No predecessor callback; no wait-again after a failed login. Live tests subscribe during the login wait, not during carrier I/O.
- **`useQuery` still lists `restoring` as an effect dependency** (`react-core.tsx:184, 225`). Unchanged residual. Identity already includes `authGeneration` (`react-core.tsx:167`), so a failed login remounts; do not treat `restoring` as fixed.
- **Waiter coverage is mutation + `online()`, not `subscribe` / `me()`.** Those four share `operationAuthority()` with `waitForResume=true` (`client.ts:283`, `:402`, `:616`, `:720`). Same join path; not a second pin.
- **`goOnline` still calls `setResume` after `await authority()`** (`client-offline.ts:282-284`). One turn after a cancelled, already-fulfilled tail where a new mutation could see no replacement barrier yet. `online()` itself still `await run`. Not the prior hang.
- **Abort after `/api/resume` has already returned**, during `commitMany` / `drainOutbox`, is not the ignore-abort fetch case the new tests hold. `commitMany`’s `current` is `() => !signal.aborted` (`client-offline.ts:472`); drain checks the signal around each intent (`client-outbox.ts:173-219`). Optional to pin.

---

**READY.** Prior resumeTail hang is fixed: `withAbort` wakes captured waiters, `resumeAfterAuth` publishes the replacement barrier before they pass `transitionAuthority`, and late cancelled resume bodies are fenced before they can mutate auth, connection, `lastRefusal`, or the outbox.
