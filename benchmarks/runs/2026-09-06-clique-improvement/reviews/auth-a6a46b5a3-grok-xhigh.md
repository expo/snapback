I'll review the Snapback2 auth/offline lifecycle patch independently: first I'll load the review constraints and the patch, then the relevant source, tests, and LLP 1002/1012.The review skill’s write/network workflow conflicts with this read-only independent review, so I’ll inspect the patch, LLPs, and source myself.The patch is large; I’ll keep reading the remaining hunks and the auth/offline source they touch.I’ll read the auth/offline lifecycle in `client.ts` and `client-auth.ts`, then the tests that pin those paths.The recovery and fence paths are the riskiest; I’ll read resume, outbox drain, and the new tests next.# Review: Snapback2 auth/offline lifecycle `a6a46b5a3`

**Base:** `30e4707ce`  
**Head:** `a6a46b5a3`  
**Verdict:** **CHANGES_REQUIRED**  
**Reviewer:** Grok 4.6, read-only source review. I did not execute tests, mutate the tree, or inspect other reviews.

The patch’s intent is right: keep interrupted startup sync pending, let a confirmed session or restored bearer recover metadata/outbox through the existing resume flight, swallow metadata refusal once custody is installed, and make one-shot held reads wait for an account transition. The new SQLite regressions pin the skip-before-hydrate and pending-`me` windows, metadata-refusal login outcomes, and `query()` issued *after* login is already in flight.

Those tests do not cover the rest of “login before `ready`,” and two new seams reintroduce the original failures: a permanently rejected `ready`, and a confirmed login that never starts resume.

---

## Material findings

### 1. Login before `ready` during startup metadata/resume rejects `ready` forever

**Files:** `snapback2/packages/snapback2/src/client.ts:1038-1056`, `:1262-1269`, `:1130-1134`, `:1098-1106`; `snapback2/packages/snapback2/src/client-auth.ts:163-167`; `snapback2/packages/snapback2/src/client-wire.ts:313-319`

**Interleaving**

1. Construct a client with `tokenStore` + offline store (queued outbox optional).
2. Let `initializeOffline` pass the `operationFence > 0` check (`client.ts:1041`).
3. Wait until `/api/auth/me` has succeeded (auth snapshot is already `authenticated`) and `/api/manifest` or `/api/resume` is in flight.
4. Call `login` / `signup` / `guest` *before* `ready` settles.

`transition()` runs synchronously (`client.ts:1262-1265`): `operationFence += 1`, `authState.suspend()`, `abortResume()`. It then waits on `this.ready` (`:1269`).

That wait is the problem:

- Startup **metadata** uses the fence captured at `initializeOffline` start (`:1042-1052`). After login bumps the fence, `ensureAuthority` throws `E_AUTH_SUPERSEDED`.
- Startup **resume** uses `resumeController`. `abortResume()` aborts it. `throwIfAborted` throws a raw `AbortError` (`client-wire.ts:313-319`), not a `SnapbackRefusal`.

`ClientAuth.initializeOffline` swallows confirm failures (`client-auth.ts:157-158`) but **rethrows** metadata/resume failures unless they are retryable / `E_OFFLINE_RESUME` / `E_OFFLINE_RESET` (`:163-167`). `AbortError` and `E_AUTH_SUPERSEDED` are neither.

`ready` is `localReady.then(() => this.initializeOffline())` (`client.ts:203`). Once that rejects, every later `await this.ready` throws the same error: `operationAuthority`, `online()`, and the next `login()` (`transition` at `:1269`). The instance cannot recover without constructing a new client.

This is still “login started before `ready`” — the case this patch claims to fix. Confirm publishes `authenticated` *before* metadata/resume (`client-auth.ts:149-163` via `confirmAuth`), so a user who switches account after restoration but while `ready` is still pending hits this window.

**Impact**

Account switch (or any session attempt) during the metadata/resume tail of cold start fails the session, permanently rejects `ready`, and bricks mutations, `online()`, and further logins on that client. Outbox recovery never runs.

The new tests only hold `/api/auth/me` or call login before hydrate (`auth-restoration.test.ts:710-744`). They never hold `/api/manifest` or `/api/resume` and then login.

**Fix direction**

Treat startup metadata/resume interruption the same way confirm is treated: if the failure is `E_AUTH_SUPERSEDED`, abort, or an authority fence mismatch, keep `offlineStartupPending`, return from `initializeOffline` **without** rejecting `ready`, and let the session’s `resumeAfterAuth()` start the recovery flight. Do not let a raw `AbortError` become the client’s terminal `ready` reason.

---

### 2. Confirmed login skips pending resume unless metadata already loaded

**Files:** `snapback2/packages/snapback2/src/client.ts:707-708`, `:732-738`, `:796-803`; contrast `me()` at `:722-727`

**Interleaving**

1. Login (or signup/guest) starts before `ready` so `initializeOffline` hits `operationFence > 0` and returns with `offlineStartupPending = true` (`:1040-1041`).
2. The session installs the bearer, then awaits `ensureOfflineMetadata` (`:702-704`).
3. Manifest/program fails in either of these ways:
   - retryable transport (`ensureOfflineMetadata` returns without throwing, `:801-802`);
   - non-retryable shape/refusal that `ClientAuth.session` swallows because custody still matches (`client-auth.ts:114-117`).
4. `offlineMetadataLoaded` stays `false`.
5. `session()` does `if (this.offlineMetadataLoaded) this.resumeAfterAuth()` (`client.ts:708`) and returns success.

`resumeAfterAuth()` itself only needs pending + authenticated + principal (`:733`). `me()` already calls it unconditionally after confirm (`:726`). The session path is the one that dropped the recovery call.

`offlineStartupPending` is only cleared by a successful `performResume` (`:1106`) or a tokenless empty partition (`:1056`). Here it stays true forever unless something else calls `me()` or `online()`.

That is the original Grok r2 hole (“resume is not retried unless something calls `online()`”) for any confirmed session whose metadata fetch is not clean.

The `offlineMetadataLoaded` gate is not what protects the past-fence contract. Ordinary re-login is already a no-op because a successful startup resume clears `offlineStartupPending`. LLP 1002 §9 says a confirmed session resumes metadata and the outbox through the existing resume flight; deferred failures stay on `lastRefusal` and `online()` retries **that flight**, not “never start it.”

**Impact**

Installed login succeeds (`auth-restoration.test.ts:747-774` pins that) while a durable outbox from interrupted startup does not replay. A single flaky `/api/manifest` during the recovering login is enough. The new outbox tests (`:710-744`) only pass because `owner.fetch` serves a clean manifest.

**Fix direction**

Call `resumeAfterAuth()` after a successful session whenever pending is set, matching `me()`. `performResume` already re-runs `ensureOfflineMetadata` (`:1145`). If metadata still fails, keep pending, record `lastRefusal`, and leave retry to `online()`. Do not use `offlineMetadataLoaded` as a resume fence.

---

### 3. Live/subscribe hydrating delivery still answers through a login transition

**Files:** `snapback2/packages/snapback2/src/client.ts:478-482` vs the new `query()` wait at `:217-235`

**Interleaving**

1. Cold client is `hydrating` with a stored bearer and predecessor coverage.
2. `login` is in flight (`suspend()` keeps `hydrating`).
3. Mount a live `useQuery` / call `subscribe()` (default React path is live).

`subscribeRegular`’s hydrating shortcut waits only on `localReady`, then `answerOffline`, and delivers if still `hydrating` (`:478-482`). It does not wait for `transitionTail` and does not `ensureAuthority` after the carrier read.

`query()` now does both (`:217-230`). The new test (`auth-restoration.test.ts:776-805`) uses `client.query` only. Default `useQuery` is `live !== false` (`react-core.tsx:163, 188-191`).

`transition()` closes *existing* subscriptions (`:1267`), so a sub that was already open is torn down. A **new** subscribe during the login still takes the hydrating shortcut and can callback predecessor rows (alice’s held inbox) while bob’s login is in flight.

**Impact**

Same class of early held-read leak the patch claims to close, on the API React actually uses. After install, `authGeneration` re-keys the hook, so the flash can be brief — but `subscribe()` callers without that re-key keep the predecessor delivery.

**Fix direction**

Reuse the `query()` protocol on this shortcut: wait until `transitionTail` is stable, snapshot authority, read, `ensureAuthority`, and if the fence moved, wait again rather than delivering. Add a regression that holds login and asserts a live subscribe/useQuery does not dispatch predecessor coverage.

---

## What looks correct (not findings)

- `offlineStartupPending` set before the fence check (`client.ts:1040-1041`) is the right latch for the *skip* path.
- Failed racing login still restores hydrating + retry, and `me()` then calls `resumeAfterAuth()` (`:722-726`). That matches the pending-`me` / before-hydrate outbox tests.
- Metadata refusal no longer rejects an installed, still-current bearer (`client-auth.ts:114-117`); expiry and close still reject (`auth-restoration.test.ts:807-826`).
- `query()` waits for a stable transition tail *before* selecting a partition (`client.ts:217-221`), which is the right shape for LLP 1012 §4.
- Past-fence release is still owned by `resumeSucceeded` / `canReplay` (`store/outbox.ts:266-288`). Ordinary re-login does not drain just because a login grant arrived; `resumeAfterAuth` no-ops once pending is cleared. I did not find a new “login grant opens the fence” hole in this diff.

---

## Optional follow-ups

- **`query()` post-read fence is throw-once, not wait-again.** After the wait loop, `answerOffline` is awaited (`client.ts:228-234`). A login that starts in that window makes `ensureAuthority` throw `E_AUTH_SUPERSEDED` instead of looping back to `transitionTail`. Safer than returning predecessor bytes; still not “wait for the transition.” Wrap wait + read + check in a retry. The new test does not cover this order (it starts the query *after* login is already in flight).
- **Retained-coverage pin is `[]`.** `seededStore` commits inbox `data: []` (`tests/fake-owner.ts:221-224`). Failed-login `held.data === []` (`auth-restoration.test.ts:812`) cannot distinguish retained complete coverage from an empty miss. Seed a non-empty held page.
- **No test that ordinary re-login does not release a past-fence queue.** The pending bit is the fence; it is unpinned. One test: successful startup resume, advance past `fenceDays`, re-login, assert no mutation execution until `online()`/`resume`.
- **`useQuery` still lists `restoring` as an effect dependency** (`react-core.tsx:184, 225`). That residual is unchanged by this patch; do not treat it as fixed.

---

## Tests I did not run

I did not execute the suite. The prompt states 118 affected tests passed; this review does not re-verify that. Findings above are from the patch, current source, the new `auth-restoration.test.ts` cases, and LLP 1002 §9 / LLP 1012 §4.

---

**CHANGES_REQUIRED.** Finding 1 is enough on its own: the patch’s defining scenario (session started before `ready`) still permanently kills the client if it lands in the metadata/resume tail. Finding 2 leaves interrupted-startup outbox recovery back on `online()`. Finding 3 leaves the live held-read path unfenced.
