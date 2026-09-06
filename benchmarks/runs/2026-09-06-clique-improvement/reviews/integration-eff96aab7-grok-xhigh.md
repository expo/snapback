I'll start by loading the review skill and LLP context, then inspect the integrated Snapback2 snapshot against main with the three already-reviewed deltas.This is an interaction review of the integrated commit, not a whole-codebase pass. I’ll load the review prompt, the three-delta patches, and the governing LLPs without looking at other reviews.I'll map the integration against the three reviewed deltas and the listed contracts, then read the LLPs and boundary code that those interactions actually hit.The snapshot isn’t a git repo, so I’ll work from the three patches and the integrated source. Next I’ll extract the vs-auth and vs-assets diffs and the interaction surfaces they name.The vs-patches isolate cursor plus the other two branches. I’ll now read the integrated client, auth, upload, outbox, and twin/IR files those contracts actually share.Client is 1482 lines as claimed. I’ll read the mutation/json/auth/upload/outbox paths next, then the tests that claim to cover those interleavings.The json/onSend/cleanup path is the main interaction seam. I’ll read the twin mint, cached certificates, and tests that claim to cover abort, terminal session, and provenance together.The three vs-patches and the client/auth/upload/outbox/twin/IR seams are in. Verdict is **CHANGES_REQUIRED**: the owner’s 401 session path expires the captured token before automatic discard, which is the live interleaving the 200-body tests do not cover.

## Verdict: **CHANGES_REQUIRED**

This is an interaction review of integrated `eff96aab7` vs main `5510cdf7f` (auth `9b22e7b48`, assets `6351b2d49`, cursor `f997292c6`). I did not read other reviews, did not run tests, and did not edit anything. Caps/refs were taken as given. Integrated full tests are underway; no pass is claimed.

No unique source hunk from `vs-auth.patch` / `vs-assets.patch` looks dropped: `result_pages` + return-path minting, `withAbort` / `resumeAfterAuth` / `authRestoration`, `withMutationUploads` / `onCustody` / `onSend`, and the `expiration.cleared` guard are all present in the snapshot. The miss is semantic: auth’s 401 expiry and assets’ discard-before-expiry were wired for a 200-body mutation result, not for the owner’s real session status.

---

### Finding 1 — Severity: bug

**File:** `snapback2/packages/snapback2/src/client.ts:288` (adapter), `:879` (`json` 4xx expiry), `:303–322` (post-submit expiry only on a returned result); `snapback2/packages/snapback2/src/client-upload.ts:134–136` (discard in `catch`); owner status `snapback2/crates/snapback2/src/serve.rs:837–838`

**What is wrong**

LLP 1006 §10: *“Current-authority terminal expiry follows discard.”* The integration implements that only when `/api/mutation` returns **HTTP 200** `{ state: "rejected", code: "E_AUTH_SESSION" }`.

The owner maps `E_AUTH_SESSION` to **HTTP 401**. That hits `Client.json`’s 4xx path, which expires the captured token **before** `withMutationUploads` can discard.

Positional contract at the mutation site:

```288:288:snapback2/packages/snapback2/src/client.ts
              json: (path, init, onSend) => this.json(path, init, authority, true, true, false, onSend),
```

That is `(enforceAuthority=true, clearTerminalSession=true, authRestoration=false, onSend)`. `onSend` is correctly the 7th argument (Transport’s 3rd is remapped). `clearTerminalSession=true` is the interaction bug: auth’s 401 expiry runs inside `json` before assets’ cleanup.

**Interleaving / repro** (plain client, no offline store; this is the owner’s real session shape):

1. Authenticated `client.mutation(op, { photo: file })`.
2. Automatic upload succeeds; `onSend` marks `custody = "wire"` (`client.ts:844`, `client-outbox.ts:84–87`).
3. `POST /api/mutation` returns **401** `{ code: "E_AUTH_SESSION", family: "auth", ... }` (`serve.rs:837–838`).
4. `json` (`client.ts:879–880`) calls `expireSession` for the captured token, then throws.
5. `withMutationUploads` `catch` (`client-upload.ts:134–136`) tries `discardAutomaticUploads` with that same `authority`.
6. `discard` → `host.json` → `ensureAuthority` fails (`E_AUTH_SUPERSEDED`); discard is swallowed.
7. `mutation()` `catch` (`client.ts:312–321`) does not expire (already done) and does not return a rejected result, so the `:303` “discard first while its bearer is still current” path never runs.

Bytes from this call stay unclaimed until `listUploads` / grace sweep. The 200-body tests in `assets.test.ts:708–756` never take this path.

Same `catch` also misses **upload** 401: `fetchResponse` (`client-upload.ts:366–369`) records the refusal and throws **without** expiring. First-file 401 ⇒ `records=[]`, no discard, thrown `E_AUTH_SESSION`, `snapshot.token` still set. That is captured-token evidence without custody clear, until some later `json()` 401.

Outbox replay is not this bug: `drainNow` uses a separate `json(path, init, authority)` with default `clearTerminalSession=true` and `custody === "outbox"` (retain bytes). Leave that adapter alone.

**Fix direction**

1. Mutation submit adapter: `clearTerminalSession=false` — `this.json(path, init, authority, true, false, false, onSend)`.
2. After `withMutationUploads` returns **or** throws, expire on terminal session using the same `expiration.cleared &&` successor guard already at `:307–308`.
3. Order becomes: discard while the bearer is current, then expire. That matches LLP 1006 §10 and also expires upload 401 after the `catch` discard.

`client.ts` is 1482/1500; the catch expire is a few lines. Prefer putting shared terminal handling next to the existing mutation expire block rather than growing `json`’s boolean list.

Add a test that mocks `POST /api/mutation` as **401** `E_AUTH_SESSION` after a File upload and asserts: discard ran with `Authorization: Bearer <captured>`, then `snapshot.token === undefined`, and the thrown/rejected code is `E_AUTH_SESSION` (not `E_AUTH_SUPERSEDED`). Mirror with first-file `/api/upload` 401.

---

### Finding 2 — Severity: bug

**File:** `snapback2/packages/snapback2/src/client-upload.ts:90–99`; contrast `snapback2/packages/snapback2/src/client.ts:1095` and `:1134`; `snapback2/packages/snapback2/src/client-wire.ts:323–331`

**What is wrong**

Auth added `withAbort` so resume/outbox drain waiters release when a custom `fetch` **ignores** `AbortSignal`. Assets cleanup claims a 2s bound by passing a timer-aborted signal into `json()`, but `json()` only samples the signal at checkpoints. It does not race `fetchImpl`.

`discardAutomaticUploads` runs **inside** `mutation()`’s `trackWrite`. `transition()` waits on `settleWrites()` before login/logout. A hung cleanup pins account change.

**Interleaving / repro**

```ts
fetch: async (input, init) => {
  const path = new URL(String(input)).pathname;
  if (path === "/api/manifest") return json(manifest());
  if (path === "/api/upload") return json(image);
  if (path === "/api/mutation") {
    return json({ state: "rejected", code: "E_REQUIRE:NOT_MEMBER", family: "rule",
      message: "no", guide: "quarry" });
  }
  if (path === "/api/uploads/discard") {
    // ignore init.signal
    await new Promise(() => {});
  }
  throw new Error(path);
}
```

1. `client.mutation(api.assets.send, { photo: file })` → rejected, then automatic discard.
2. 2s timer aborts the controller; `fetch` never settles; `json()` stays on `await this.fetchImpl`.
3. `client.auth.login(...)` sits in `settleWrites()`. Resume `withAbort` does not help: this wait is the mutation write, not `resumeController`.

The same hole exists for **mutation outbox drain** (`client.ts:1210`): `drainNow` has no signal and no `withAbort`, is inside `trackWrite` when `submitMutation` drains, and holds `drainTail`. Resume abort cannot cancel that in-flight drain. Auth made resume abortable; the mutation/cleanup write path that serialize ahead of it was not.

**Fix direction**

Wrap `discardUploadFor`’s `host.json(...)` in `withAbort(signal, () => ...)` (same helper as resume). Keep swallowing abort in `discardAutomaticUploads` so cleanup cannot replace the mutation outcome.

For mutation drain: pass a controller into `drainNow` / `drainOutbox` and race with `withAbort`, aborted by `close()` / `transition()` / `offline()` the same way `abortResume()` aborts resume. Do not reuse mutation `onSend` as `json`’s 3rd argument (`Transport` 3rd ≠ `Client.json` 3rd).

---

## Checked and not raised as integration bugs

**Positional `json` / `onSend` (current call sites).** Mutation remaps Transport `onSend` to argument 7. `drainNow` and resume close over `authority` as argument 3. `UploadHost.json` stays `(path, init, authority)`. Those sites are consistent. The 5th positional (`clearTerminalSession`) is what Finding 1 gets wrong.

**200-body terminal + cleanup.** `client.ts:292–308` + `expiration.cleared` matches LLP 1006 for the synthetic 200 path `assets.test.ts` covers. Successor `expireSession` is a no-op on token/custody mismatch (`:1304–1305`). That path is not the owner’s 401 path.

**Cursor / cached certificate / recovery.** Engine and twin mint from `certificate.result_pages[returnPath]` (`execution_record.rs:44–47`, `runner.ts:1111–1112`). Paths use the same `index` / `then` / `else` / `body` scheme. `program_hash` includes `digest(certificate)` (`registry.rs:493–498`), so a `result_page_site` → `result_pages` cert change bumps `programGeneration` and forces `/api/program` refetch. Resume log watermarks use the executed return path (`writer_resume.rs:320–324`). `validateScanCursor` is scan-time on both twins (`scan.rs:18`, `value-runtime.ts:293`). Conditional tokens on unselected branches are not validated. Coherent for reconnect.

**No source delta lost.** vs-auth = assets+cursor on auth; vs-assets = auth+cursor on assets. Integrated `client.ts` / `client-upload.ts` / `client-auth.ts` / `client-outbox.ts` / evaluator runner / `writer_resume.rs` contain those hunks. Only LLP metadata was described as unioned.

---

## Optional coverage (not required for the verdict)

- No test where `/api/mutation` is **401** `E_AUTH_SESSION` after an automatic File upload (the live owner shape). Existing terminal+cleanup tests use HTTP 200.
- No test that discard `fetch` ignores abort and that `login` still starts after ~2s.
- Offline app upgrade with IDB still holding `result_page_site` and no network: new `mintNext` sees empty `result_pages` and returns `null` for non-retained evaluates. Reconnect is fenced by `programGeneration`. Evaluator fallback or treating old certs as unusable would close the offline window; that is cursor × 1012, not auth×assets.
- `Client.json`’s four trailing positionals remain a footgun; a named options object would have made Finding 1 harder to ship. Not a functional defect by itself.

I did not run the suite and did not verify browser/UI behavior.
