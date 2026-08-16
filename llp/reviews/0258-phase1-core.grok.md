# LLP 0258 Phase 1 core (450d150e6) landed-code review — grok

**Reviewer:** grok CLI, grok-4.6, xhigh, read-only charter
**Date:** 2026-08-15
**Subject:** same as the codex artifact
**Verdict as received (all findings fixed in the follow-up landing; the class-9 CLEAN verdict was overturned by the codex TOCTOU finding, confirmed by a deterministic race test):**

I'll review the landed LLP 0258 Phase 1 core read-only: first the D2–D8 / D6 constraints, then the client.auth and app-client implementation against those ten defect classes.Next I’ll pull the commit file list and read the client.auth / app-client implementation against those D2–D8 constraints.HEAD is ahead of 450d150e6; I'll review the current files from that commit and read the auth/app-client implementations next.The projection and handshake live in `index.mjs`; I’ll read those sections next, including restore/session metadata.The uncoordinated handshake looks like it caches without publishing. I’ll trace credential adoption, refresh, and session projection next.NOT READY

Reviewed `450d150e6` as it stands at HEAD (`218b160f6`); the listed client files are unchanged from that landing.

### 1. MATERIAL — class 1: uncoordinated handshake never publishes success (`replaceBearerToken` / external bearer)

`#uncoordinatedAuthSession` writes `__authSessionLastSuccessful` and returns, and never calls `#publishCurrentPrincipal`. `replaceBearerToken` always `clearAuthSession()` (which publishes `loading`) and then installs the successor bearer without a success observer. The public `authSession` wrapper only publishes `blocked` on selected errors.

```3101:3108:packages/snapback-client/index.mjs
      if (
        this.__authCounterError === null
        && this.__authSessionCacheGeneration === cacheGeneration
      ) {
        this.__authSessionLastSuccessful = projected;
        this.__authSessionCapture = null;
      }
      return projected;
```

```3286:3293:packages/snapback-client/index.mjs
        this.clearAuthSession();
      } catch (error) {
        failures.push(error);
      }
      this.__connectionGrants.clear();
      this.__receiptRing.length = 0;
      this.__liveStreamManagers?.clear?.();
      this.bearerToken = token;
```

```3022:3036:packages/snapback-client/index.mjs
  authSession(options = {}) {
    return this.#authSession(options).catch((error) => {
      // ...
        this.#publishCurrentPrincipal(currentPrincipalBlocked(error));
      }
      throw error;
    });
  }
```

**Failure:** `createExternalSessionClient` with a valid bearer, or `replaceBearerToken('sbs_next')` after a live session. `/auth/session` succeeds and live handles may resume, but `client.auth.currentPrincipal()` stays `{ status: 'loading' }` for the life of the client. `replaceBearerToken(null)` likewise never settles `anonymous`.

Coordinated/agent success *does* go through `#cacheAuthSession` → `#publishCurrentPrincipal`. The hole is the uncoordinated path.

### 2. MATERIAL — class 1: failed credential adoption whose barrier rejects leaves `loading`

Password issuance publishes only after `transition()` resolves. A barrier that starts (transport `clearMemory` → `clearAuthSession` → `loading`) and then fail-closes throws `SNAPBACK_AUTH_TRANSITION_FAILED`. That code is not in `authSession`'s blocked list (`SNAPBACK_AUTH_CUSTODY_*` / `SNAPBACK_CLIENT_AUTH_*` / handshake codes only). `#publishCredentialPrincipal` also no-ops when the handshake cache is already gone.

```5873:5882:packages/snapback-client/index.mjs
    await this.authCoordinator.transition(currentCapture, {
      authority,
      bearer: response.token,
      refreshAfterMs: response.refreshAfter,
    }, 'login');
    const projected = recoveryCodes
      ? credentialPublicProjectionWithRecoveryCodes(response)
      : credentialPublicProjection(response);
    this.#publishCredentialPrincipal(projected);
    return projected;
```

```2874:2876:packages/snapback-client/index.mjs
  #publishCredentialPrincipal(credential, session = this.__authSessionLastSuccessful) {
    if (!session || !credential?.session) return;
    this.#publishCurrentPrincipal(currentPrincipalFromSession(session, credential));
```

```2520:2556:packages/snapback-contract/auth-coordinator.mjs
      const primaryError = coordinatorError(
        'SNAPBACK_AUTH_TRANSITION_FAILED',
        'authority transition barrier did not settle',
        { phase: failedPhase, causeCode: error?.code ?? null },
      );
      // ...
      throw primaryError;
```

**Failure:** `authPasswordSignup` / `signUpWithPassword` POST succeeds; resume handshake throws; coordinator fail-closes. Caller gets a rejected promise; `currentPrincipal()` remains `loading` — neither `blocked` nor the predecessor. Same stuck state if `authRefresh` CAS-succeeds after something already nulled `__authSessionLastSuccessful` (the post-rotate `clearAuthSession()` + `#publishCredentialPrincipal(..., null)` pair).

### 3. MATERIAL — class 2: restored sessions fabricate `provider` from `/auth/session` availability

`#cacheAuthSession` (restore / `authSession({ force: true })` during bootstrap) calls `currentPrincipalFromSession(session)` with no credential. `provider` falls back to `session.provider.key`. The shipped handshake hard-codes that key to `'email-code'` as *availability*, not issuance. Password credentials use `'local-password'`. Expiry is *not* fabricated (`null` + the type comment).

```1889:1900:packages/snapback-client/index.mjs
  const credentialSession = credential?.session ?? null;
  return Object.freeze({
    status: 'authenticated',
    // ...
    provider: credentialSession?.provider ?? session.provider.key,
    // ...
    expiresAt: credentialSession?.expiresAt ?? null,
    absoluteExpiresAt: credentialSession?.absoluteExpiresAt ?? null,
  });
```

```3834:3834:packages/snapback-client/index.mjs
    this.#publishCurrentPrincipal(currentPrincipalFromSession(session));
```

```15133:15133:src/server.rs
            provider_key: "email-code".to_owned(),
```

```570:573:packages/snapback-client/index.d.mts
  /** Credential-entry projections carry expiry; a restored session handshake
   * does not, so these fields remain explicitly unknown until enriched. */
  expiresAt: number | null;
```

**Failure:** Password sign-in, `dispose`, new `createSnapbackAppClient` on the same durable partition. `currentPrincipal().status === 'authenticated'` (correct) but `provider === 'email-code'` and `expiresAt === null`. D6’s “current” provider is a lie; expiry is honestly unknown.

### 4. MATERIAL — class 4: synchronous notify inside the authority publication fence

`subscribeCurrentPrincipal` does not queue a microtask (0238 D3). `#publishCurrentPrincipal` notifies synchronously. `#cacheAuthSession` runs that notify from `commitAuthorityPublication` while `__authorityPublicationDepth > 0`. Listener work that touches `clearAuthSession` / `replaceBearerToken` / `setBearerToken` hits `#assertNotInAuthorityPublication` and is swallowed.

```2852:2871:packages/snapback-client/index.mjs
  #subscribeCurrentPrincipal(listener) {
    // ...
    this.__currentPrincipalListeners.add(listener);
    return () => { this.__currentPrincipalListeners.delete(listener); };
  }

  #notifyCurrentPrincipal() {
    for (const listener of [...this.__currentPrincipalListeners]) {
      try { listener(); } catch { /* current-principal observation cannot own auth */ }
    }
  }

  #publishCurrentPrincipal(snapshot) {
    // ...
    this.#notifyCurrentPrincipal();
  }
```

```3588:3598:packages/snapback-client/index.mjs
      this.__authorityPublicationCapture = capture;
      this.__authorityPublicationDepth += 1;
      try {
        const value = commit();
```

```3395:3398:packages/snapback-client/index.mjs
  clearAuthSession() {
    this.#assertNotInAuthorityPublication(
      'auth-session clearing is forbidden inside an authority publication callback',
    );
```

**Failure:** Subscribe with `() => { void client.auth.authSession({ force: true }); }` or `clearAuthSession()`. On coordinated handshake commit the listener throws `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`; the throw is eaten; later listeners still run. Deferral would move notify outside the fence. There is also no subscribe-time exactly-once current-snapshot notification.

---

### 5. MINOR — class 5: `blocked` is typed by code, but facts/remediation are generic

```1904:1925:packages/snapback-client/index.mjs
const currentPrincipalBlocked = (error) => {
  const causeCode = error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_AUTH_HANDSHAKE_INVALID';
  const diagnostic = Object.freeze({
    // ...
    message: 'Authentication custody or authority could not settle.',
    details: Object.freeze({ causeCode }),
  });
  return Object.freeze({
    status: 'blocked',
    diagnostic,
    remediations: Object.freeze([Object.freeze({
      kind: 'retryAuthBootstrap',
      // ...
      description: 'Retry after repairing the named custody or authority condition.',
    })]),
  });
};
```

`diagnostic.code` / `details.causeCode` survive. Phase, original remediations, and a specific cause/remediation pair do not. Custody corruption and a handshake mismatch look the same to a caller that only reads `message` + `remediations`.

### 6. MINOR — class 10: `changePassword` uses the entry-unsettled refusal

D4 says the entry refusal never applies to `changePassword`. The facade still throws `SNAPBACK_AUTH_ENTRY_UNSETTLED` for `loading` / `refreshing` / `blocked`.

```790:795:packages/snapback-client/app-client.mjs
    changePassword: (input) => serializeOwner(owner, async () => {
      requirePasswordMechanism(owner);
      const principal = owner.client.auth.currentPrincipal();
      if (['loading', 'refreshing', 'blocked'].includes(principal.status)) {
        throw unsettledEntryError(principal.status);
```

**Failure:** Authenticated user, someone calls `client.clearAuthSession()` (projection goes `loading`), then `appClient.auth.changePassword(...)`. The rotate arm is refused with an *entry* diagnostic. The authenticated-principal entry refusal is correctly *not* applied; this is the code/contract mismatch.

---

### Classes checked and CLEAN

- **3 Refresh-vs-barrier race — CLEAN.** `clearMemory` (not quiesce) is what publishes `loading`, via `clearAuthSession()`, which also nulls `__authSessionLastSuccessful`. `compareAndRotateBearer` is capture+revision CAS. The post-refresh republish reads `lastSuccessful` *after* the await as a synchronous trio; if a clearing barrier already ran, `session` is `null` and `#publishCredentialPrincipal` does not put predecessor `authenticated` back. (That no-op is finding 2, not a false-authenticated republish.)
- **6 Secret hygiene — CLEAN.** Snapshots, bootstrap facts, and new refusals do not carry bearer / password / recovery bytes. Signup recovery is returned once and not stored on the owner; `currentPrincipalFromSession` reads only `credential.session`. Fetch paths pass `forbiddenSecrets`. Tests stringify bootstrap/principal/history against those classes.
- **7 D2 registry — CLEAN.** Single-flight `constructing` entry; failure `catch` deletes the registry row before waiters see the rejection (no poison). `serializeEntry` + `disposing`/`disposePromise` handles overlapping dispose/construct (Strict Mode / remount). Rebind vs conflict vs policy-rotation vs stale-generation match D2. Refcount increments only after a successful rebind; last dispose closes and evicts.
- **8 D3 custody — CLEAN.** `durable-required` refuses in `preflight` (`SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`) before `constructOwner` / fetch. `resolveCustody` uses memory only for `volatile-explicit`, and that arm reports `carrier: 'memory'`, `grade: 'volatile'`.
- **9 D5 process-local record — CLEAN.** Displacement is authorized only by `exactCapture(supervisedAdoptionCapture, captureAuthority())` against the live capture, so a stale record cannot authorize a later authority. The listener invalidates on foreign transitions when `!ownerTransitionInFlight`. Entry runs on `serializeOwner`; D5 withhold uses `__withholdCurrentPrincipalPublication` (public principal stays `refreshing`, not intermediate `anonymous`). Failed issuance after sign-out settles anonymous + `SNAPBACK_AUTH_ENTRY_FAILED` (`settledAnonymous: true`); the supervised capture is cleared; remint mid-entry only rebinds.
- **10 D4 result contract (except finding 6) — CLEAN.** Facade methods are typed as the wrapped client methods and return those results. Signup `recoveryCodes` are returned and not retained/re-exposed on bootstrap/principal/history. `changePassword` is not subject to `SNAPBACK_AUTH_ENTRY_AUTHENTICATED`. Restored authenticated principals have `supervisedAdoptionCapture === null` and hit that refusal.

Expiry-after-restore (class 2’s second half) is CLEAN: they publish `null` rather than inventing a timestamp.
