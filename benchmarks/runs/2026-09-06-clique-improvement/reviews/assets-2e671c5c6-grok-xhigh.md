I'll start by reading the review skill and the workspace materials: the patches, LLP 1006, and only `prior-grok.md`.This is a patch review, not the `/review` orchestrator flow. I'll load the prompt, prior Grok review, LLP 1006, and both patches.Prior finding is the outbox-admission leak. Next I’ll read both patches and LLP 1006’s recovery clauses, then trace the revision against source.The revision is the recovery follow-up. I’ll map its files and then read the custody, enqueue, quota, and cancellation paths.I’ll read the rest of `revision.patch` and the matching source so I can check the prior finding and any new races.Client custody looks like it addresses the prior leak. I’ll now read the server ledger, HTTP, blob store, and writer paths for new races.I’ll read the ledger discard/claim/quota/finalize code and the client mutation wrapper next.The prior outbox-admission leak is fixed. The revision’s session-expiry reorder is a real cleanup regression on 200 `E_AUTH_SESSION` rejections; I’ll cite that as the remaining material issue.

# CHANGES_REQUIRED

Independent read-only review of patch `2e671c5c6` vs `a897055f8` (revision from `184d88c9c`). Supporting source and LLP 1006 revision (r) were read; only `prior-grok.md` was used as prior review. Tests were not executed.

The prior material finding is resolved: automatic File substitution now discards on pre-persistence outbox admission and prediction failure, and treats `store.commit` as the ambiguous boundary. Server discard of receiving bodies closes the staging file under the write lock; running finalizers keep quota and resist sweep until physical release; ready unclaimed ids still drop quota immediately.

The revision’s “settle the mutation before cleanup auth side effects” change expires a terminal session **before** best-effort discard. A 200 `state: "rejected"` `E_AUTH_SESSION` mutation — a shape this client already treats as settled — therefore never reaches `/api/uploads/discard` with a live credential. That re-opens the abandoned-upload leak on the documented definitive-refusal path.

## Prior finding

**Resolved.** `withMutationUploads` no longer sets a keep-bytes flag at `submit()` entry.

- `snapback2/packages/snapback2/src/store/outbox.ts:358-364` — `beforeCommit` runs only after grant/bound/id/prediction checks, immediately before `store.commit`.
- `snapback2/packages/snapback2/src/client-outbox.ts:83-97` — wire custody is marked only when `/api/mutation` is about to be sent; outbox custody is that `beforeCommit`.
- `snapback2/packages/snapback2/src/client-upload.ts:131-136` — `custody === undefined` discards (admission/prediction/no-submit). `custody === "outbox"` keeps. Wire 4xx non-retryable still discards.
- Focused tests exist at `real-owner.test.ts:101-167` (not re-run). A post-commit acknowledgement loss is covered; a pre-persist `commit` throw is treated as ambiguous per LLP 1006 §10.

## Material findings

### 1. Terminal 200 mutation rejection expires the session before automatic discard

- **Where:** `snapback2/packages/snapback2/src/client.ts:289-294` with `snapback2/packages/snapback2/src/client-upload.ts:128-129` and `90-98`, and `client.ts:804-805` / `1373-1376`
- **What is wrong:** For a non-throwing mutation result, cleanup runs only after `submit()` returns (`client-upload.ts:128-129`). The revision moved `expireSession` **into** that `submit` callback, so a terminal rejection clears `currentToken` first.

  `isTerminalSession` is `code === "E_AUTH_SESSION" && family === "auth"` (`client-wire.ts:125-127`). `json()` does **not** expire a still-current authority on a 200 body (`client.ts:879-896`); `mutation()` now does, before discard.

  `discardAutomaticUploads` then calls `host.json` with the pre-expiry `authority`. `ensureAuthority` requires `authority.token === this.currentToken` (`client.ts:1364-1376`). After expiry that fails with `E_AUTH_SUPERSEDED` (no HTTP `status`). The discard `catch` swallows it (`client-upload.ts:96-97`). `/api/uploads/discard` is never sent.

  This is a regression from `184d88c9c`, which discarded on `state === "rejected"` **while the token was still current**, then expired. The new test (`assets.test.ts:678-710`) only covers non-terminal `E_REQUIRE:NOT_MEMBER` plus a cleanup 401. `auth-ownership.test.ts:1231-1232` already treats `200 { state: "rejected", code: "E_AUTH_SESSION" }` as a live mutation shape, without File substitution.

  HTTP 401 on `/api/mutation` already expired inside `json()` before this revision; that path could not discard either. The 200 terminal-rejected path could, and no longer can.

- **Repro:**
  1. `createClient({ url, token: "session" })` (no partition).
  2. `await client.mutation(api.messages.sendPhoto, { conversationId, photo: file })`.
  3. `/api/upload` returns a record. `/api/mutation` returns **200** `{ state: "rejected", code: "E_AUTH_SESSION", family: "auth", message, guide }`.
  4. The call returns that rejection (`snapshot.token` is `undefined`).
  5. No `POST /api/uploads/discard` is issued. After login, `listUploads()` still contains the id; creator staging objects stay > 0.
  6. Repeat until the 20-object ceiling; later File mutations fail `E_ASSET_TOO_LARGE` even though no row claimed the bytes.

  Same leak if a concurrent auth transition makes `expireSession` throw `E_AUTH_SUPERSEDED` at `client.ts:292`: catch sees `custody === "wire"` and no `status`, so it also skips discard.

- **Fix direction (scoped):** Keep `validated(authority)` **before** cleanup for ordinary rejections (that is the 401-must-not-replace-result fix). Do **not** expire a terminal session until after `discardAutomaticUploads` has used the still-current token.

  Concretely: return the rejected result from `submit` without `expireSession`; let `withMutationUploads` discard; expire in `mutation()` after `withMutationUploads` returns, as `184d88c9c` did. If cleanup 401 already cleared the token, `expireSession` is a no-op (`client.ts:1250-1253`).

  Add a test: File mutation + 200 rejected `E_AUTH_SESSION` → discard request is sent **with the mutation bearer** → `listUploads().uploads` empty; the call still returns/settles the terminal rejection and clears the session.

Do not ship until finding 1 is fixed and covered. No unrelated redesign is required.

## What looks correct (not findings)

- **Prior outbox hole:** `E_OFFLINE_ID_BLOCK` and prediction errors occur before `beforeCommit`; `custody` stays unset; sibling uploads discard; `/api/mutation` is not used. Lost `store.commit` acknowledgement after persist keeps the intent and the bytes (`outbox.ts:358-364`, `real-owner.test.ts:137-167`).
- **Ownership / oracle:** `unclaimed_uploads` filters `created_by`. Foreign/missing discard is `{ discarded: false }`. Own claimed id is `E_ASSET_IN_USE` (`assets_ledger.rs:428-445`). `resolve_authority` refuses anonymous and carrier identities on list/discard (`writer_auth.rs:118-132`). HTTP restart test still covers Alice/Bob (`recovery.rs:4-136`).
- **Claim vs discard vs finalize:** Immediate `UPDATE … locator_table IS NULL`, then locator check in the same transaction. `asset_reserve_finalized_bytes` / `asset_mark_ready` require `receiving && reclaiming = 0` (`assets_ledger.rs:291-296`, `343-346`, `355-358`). `validate_asset_use` refuses `reclaiming` (`496-512`). Writer serializes discard with reserve/ready/failed.
- **Late bytes:** `UploadCustody::copy_from` drops the mutex across socket reads, then refuses writes if `cancelled` (`blob_store.rs:443-474`). `cancel` closes/unlinks under that mutex (`492-500`). `finalize()` will not take a cancelled file (`476-489`). Prefix copy is before begin, so it has no id to discard; after begin, late chunks cannot recreate the unlinked file (`recovery.rs:922-1005`).
- **Quota through physical custody:** Usage/list count every unlocated `receiving` row, including `reclaiming = 1`; ready rows drop out once tombstoned (`assets_ledger.rs:247-259`, `408-412`). Discard of receiving calls `mark_asset_failed` only when `cancel()` reports the file finished (`writer_assets.rs:215-230`). Sweep skips ids with `upload_active` (`writer_assets.rs:92-97`). Ready discards still free quota immediately and reuse fork-aware blob sweep. Core/unit tests encode the charge-until-close contract (`reclaim.rs:356-373`, `writer_assets.rs:691-730`).
- **Queued media / lost commit:** `state === "queued"` and ambiguous HTTP 200/422/503 bodies do not discard. Kind-mismatch two-phase `upload()` still discards. Supplied records are not in `records[]`. Cleanup failures still cannot replace a non-terminal settled rejection (`assets.test.ts:678-710`).
- **HTTP bounds:** Authorize still runs before the body; begin charges again on the writer. Upload workers remain capped at 4 (`serve.rs:30`, `209`). Staging object/byte caps unchanged.

Focused JS/Rust checks reported passing were not re-run.

## Observations (non-blocking)

- **Discard of a paused receiving body does not abort the HTTP read.** `copy_from` only notices `cancelled` after the next `read`. The upload worker stays occupied until the client sends or closes. Staging quota is released, but the upload class is still 4 workers, so four held sockets yield `E_OWNER_BUSY` rather than a new upload. Pre-existing occupancy; more visible now that in-progress discard is a supported recovery.
- **`listUploads` is the staging-quota set, not “never referenced.”** Ready + locator null + `reclaiming = 0` (24h replacement grace) still appears and can skip grace. Receiving + `reclaiming = 1` (discarded but still finalizing) now appears with usage until bytes close — correct for the charge, surprising for a bulk “discard everything in the list” UI.
- **Attempted `store.commit` that throws before any durable write still keeps bytes** (`custody === "outbox"`). Matches LLP 1006 §10 “attempted persistence”; a disk-full/IndexedDB failure before persist can leave unclaimed uploads until explicit `discardUpload` or grace.
- **`E_ASSET_IN_USE` on discard is still HTTP 400** (`refusal_status` default). Upload asset input errors are 422.
- **No pagination test** (`after`/`next`); the HTTP test fills 20 objects against a page size of 100.
- **`RuntimeError::AssetTooLarge` via `from_runtime`** still attaches the staging-recovery rewrite to every `AssetTooLarge`, including column-bound oversize on authorize/begin.
