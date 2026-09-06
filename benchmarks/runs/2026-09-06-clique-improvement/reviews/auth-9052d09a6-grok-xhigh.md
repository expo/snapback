I'll do a read-only independent review of the final patch against the baseline, starting with the workspace layout, the two patches, LLP 1002/1012, and only `prior-grok.md`.This is an independent read-only review of the final patch, not the `/review` skill. I'll load the prompt, my prior findings, the LLPs, and both patches.Prior findings are loaded. Next I’ll read both patches and the lifecycle source they touch.I'll read the lifecycle source and the rest of both patches, focusing on recovery, fencing, and the new tests.The revision’s recovery and fence paths are in. I’ll read those functions in full and check subscribe, resume, and session interleavings.**CHANGES_REQUIRED**

Read-only review of `9052d09a6` against `30e4707ce` (revision from `a6a46b5a3`). I did not run tests, edit the tree, or inspect the other reviewer file. 130 affected tests / 23 new lifecycle cases are taken as reported; local broad timing failures are not treated as green.

The three prior material findings are actually fixed in this tree. The revision then leaves `operationAuthority(waitForResume=true)` coupled to an abandoned `resumeTail`, so the same ignore-abort interruption the new tests exist to cover still stalls mutations, live `open()`, `online()`, and `me()`.

---

## Prior material findings

### 1. Startup supersession cannot poison `ready` — resolved

`transition()` aborts `startupController` before the queued action (`client.ts:1268-1269`). `ClientAuth.initializeOffline` races that abort against confirm/metadata/resume (`client-auth.ts:149-169`) and treats any abort as a cut (`client.ts:1053`). `E_AUTH_SUPERSEDED` / raw `AbortError` no longer become `ready`’s terminal reason. The four `login cuts pending initial {manifest,resume}` cases pin both outcomes.

### 2. Metadata failure cannot skip pending resume — resolved

`session()` always calls `resumeAfterAuth()` after a returned session (`client.ts:704-705`), not behind `offlineMetadataLoaded`. `performResume` → `resumeOffline` re-runs `ensureOfflineMetadata` (`client.ts:1144`). One retryable manifest cut is pinned (`auth-restoration.test.ts:850-865`).

### 3. Live and one-shot held reads fence identity — resolved for the claimed window

One-shot `query()` waits `transitionAuthority()` then `ensureAuthority` after the carrier (`client.ts:214-228`). The hydrating live shortcut does the same (`client.ts:472-478`). Tests hold login and pin both `query` and `subscribe`.

The rest of the stated union also holds in the final code:

- Queued successor: `resumeAfterAuth` captures authority only after `operationAuthority(false)` (`client.ts:733-736`). Alice cannot dispatch `/api/resume` once Bob is queued (`auth-restoration.test.ts:893-918`).
- Failed login resumes preserved custody: `run.catch(() => this.resumeAfterAuth())` (`client.ts:1302`) plus authenticated `restore()`. Pinned at `auth-restoration.test.ts:920-945`.
- Ordinary re-login does not release a past-fence queue: `offlineStartupPending` clears only on a current `performResume` success (`client.ts:1102-1105`); `captureGrant` / `noteGrant` do not call `resumeSucceeded`. Pinned at `auth-restoration.test.ts:984-1004`.

---

## Material finding (revision regression)

### Abandoned `resumeTail` still gates mutations, live `open()`, `online()`, and `me()`

**Files:** `snapback2/packages/snapback2/src/client.ts:1129-1133`, `:1254-1260`, `:729-737`, `:1272`, `:283`, `:402`, `:616`

`abortResume()` drops `resumeFlight` / `resumeController` but does **not** replace `resumeTail`. `operationAuthority()` with default `waitForResume=true` still `await`s that promise. `resumeAfterAuth()` assigns a successor tail only *after* `operationAuthority(false)` settles, and only inside its `.then`.

Startup `initializeOffline` calls `performResume` without publishing `resumeTail`, so the new “cut initial manifest/resume” tests do not see this. The deferred-recovery path does: first login’s `resumeAfterAuth` sets `resumeTail` to the recovery flight (`:736`).

**Interleaving**

1. Cold client, queued outbox, `tokenStore` for Alice (same setup as `failed login during authenticated deferred resume`).
2. `await client.auth.login(alice)`. Recovery starts; `/api/resume` is in flight. That promise is `resumeTail` (`:736`). Transport ignores abort (the case LLP 1002 §9 and the new tests require).
3. `await client.auth.login({ password: "wrong" })` rejects. `transition()` has already `abortResume()` (`:1272`) and bumped `operationFence`. Automatic recovery still works: `resumeAfterAuth` uses `operationAuthority(false)` and does not wait on the old tail. The existing test can see `resumes === 2` and one execution.
4. After that reject returns, the app does any of: `mutation()`, `subscribe()` / default `useQuery`, `online()`, `me()`.

Those callers use `operationAuthority()` with `waitForResume=true` (`:283`, `:402`, `:616`, `:720`). At the `await this.resumeTail` (`:1258`) they capture the **abandoned** flight from step 2. Replacing `resumeTail` later with the successor does not unstick an already-waiting `await`. `query()` is not on this path (`operationAuthority(false)` at `:231`).

Until the ignored-abort `/api/resume` finally settles, live `open()` does not connect, mutations do not enter `trackWrite`, and `online()` does not start a new resume. `closeTransports` already tore down the previous subscription; the generation bump remounts `useQuery`, and the new `open()` is the hung one. After the stale fetch later completes, `ensureAuthority` / `authorityCurrent` fail and the loop continues — so this is an unbounded stall, not a predecessor leak.

Before this revision, the same interruption rejected `ready`, and `await this.ready` in `operationAuthority` failed fast. Releasing `ready` without detaching `resumeTail` is the new seam. The new test never calls mutation / subscribe / `online()` in the window before `oldResponse.resolve`.

**Fix direction**

In `abortResume()`, detach waiters from the abandoned promise (replace `resumeTail` with `Promise.resolve()`). Assign `resumeTail` **synchronously** in `resumeAfterAuth()` to the whole `operationAuthority(false).then(performResume)` chain, not only inside the `.then` after the wait. Waiters that already captured the old promise cannot be rescued; new callers after the fence bump must not see it. Do not make `performResume` join `resumeFlight` across authorities as a substitute — `abortResume` already clears that field, which is why automatic recovery works and these waiters do not.

---

## Optional coverage (not CHANGES_REQUIRED)

- **Throw-once on a held carrier read.** `query()` still throws `E_AUTH_SUPERSEDED` if a transition starts during `answerOffline` (`:222-223`). That is now pinned (`auth-restoration.test.ts:1006-1036`). Spec requires a post-read authority check, not wait-again. Safer than a predecessor leak; still not “wait for the transition.”
- **Live hydrating shortcut on that same I/O window.** `ensureAuthority` throw is swallowed (`:480`). No predecessor callback, but also no wait-again delivery after a failed login. Same class as the old optional; the new live tests subscribe *during* the login wait, not during carrier I/O.
- **`useQuery` still lists `restoring` as an effect dependency** (`react-core.tsx:184, 225`). Unchanged residual; do not treat it as fixed.
- No test that `mutation` / `subscribe` / `online()` return while the aborted deferred `/api/resume` is still held. Do not treat the existing 20-flush loops as covering that.

---

**CHANGES_REQUIRED.** Prior findings 1–3 are fixed. Finding: `abortResume` leaves `resumeTail` bound to a flight the revision just abandoned, so ignore-abort interruption still stalls every `waitForResume=true` caller.
