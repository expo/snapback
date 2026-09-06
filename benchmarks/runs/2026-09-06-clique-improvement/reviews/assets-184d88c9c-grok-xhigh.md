I'll start by loading the review skill and the local patch/LLP context, then inspect the recovery changes independently.The review skill’s write-to-disk loop doesn’t apply here — I’ll do a read-only pass on the patch, LLP 1006, and supporting source.I’ll pull the LLP 1006 recovery clauses and map the patch’s files so the review stays on those surfaces.I’ll trace discard/claim/finalize, quota, HTTP, and SDK cleanup against the surrounding source next.Checking one more outbox-admission path so the no-submit finding is precise.# CHANGES_REQUIRED

Independent read-only review of patch `184d88c9c` vs `a897055f8`. Supporting source and LLP 1006 revision (r) were read; other reviews were not. Tests were not executed.

The server side of abandoned-upload recovery is sound: principal-scoped listing, Immediate tombstone vs locator, claimed ids as `E_ASSET_IN_USE`, missing/foreign as `false`, quota excluding `reclaiming = 1`, authorize-before-body, and fork-aware sweep/boot finishing bytes. The SDK correctly keeps queued writes and ambiguous/lost mutation transports, and refuses discard of a claimed id after a lost commit.

Automatic cleanup does not run on the documented no-submit path once an offline partition is open. That re-creates the staging-quota leak this patch is meant to close for the primary client shape.

## Material findings

### 1. File substitution uploads, then a local outbox admission refusal leaves those ids unclaimed

- **Where:** `snapback2/packages/snapback2/src/client-upload.ts:128-139` with `snapback2/packages/snapback2/src/client.ts:283` and `snapback2/packages/snapback2/src/client-outbox.ts:87-96` / `snapback2/packages/snapback2/src/store/outbox.ts:296-362`
- **What is wrong:** Uploads happen first (`client-upload.ts:121`). `submitted` is then set **before** `submit()` (`:128`). For a client with an open partition (`offlineRuntime.principal !== undefined`), the catch only cleans up when `!submitted`. After that flag is set, **every** `submit()` throw is treated as “maybe queued.”

  `submitMutation` still calls `outbox.enqueue` first. Enqueue throws `E_OFFLINE_ID_BLOCK` (no grant, expired grant, unknown write bound, ids exhausted) **before** `store.commit` of an intent. `offlineRefusal()` wraps that as a `SnapbackRefusal` with **no HTTP `status`**. Cleanup therefore does not run.

  LLP 1006 §10 and the issue resolution require discard on failure **before mutation submission**. This is that case: `/api/mutation` is never called and no durable intent exists. The 24-refusal and sibling-upload tests do not open a partition, so they do not catch it. The queued-media real-owner test drains a query first and therefore has a grant.

- **Repro:**
  1. `createClient({ url, as: "alice", offline: { store: fileRangeStore(dir) } })` (or any logged-in client with a store).
  2. Do **not** drain a query / do not obtain a replay grant.
  3. `await client.mutation(api.messages.sendPhoto, { conversationId, photo: file })`.
  4. `/api/upload` returns a record; then the call throws `E_OFFLINE_ID_BLOCK`.
  5. `/api/uploads/discard` is not called. `client.listUploads()` still contains that id; creator staging objects stay > 0.
  6. Repeat until the 20-object ceiling; later File mutations fail `E_ASSET_TOO_LARGE` even though no mutation was submitted.

  Same hole if `predict()` or `commit` throws inside enqueue before a queued row exists.

- **Fix direction (scoped):** Treat “intent may be durable” as the skip condition, not “`submit()` was entered.”
  - Set the keep-bytes flag only after enqueue succeeds (plain HTTP still needs the flag **before** `/api/mutation`, which is correct for lost commits).
  - Or, in the catch: if `hasOutbox` and the throw is `E_OFFLINE_ID_BLOCK` / other local admission error with no HTTP status, discard; skip discard only when a queued intent exists or the error is retryable/ambiguous (`E_WIRE_SHAPE`, 5xx, non-JSON 4xx).
  - Add a test: File mutation + open partition + no grant → `E_OFFLINE_ID_BLOCK` → `listUploads().uploads` empty / usage 0.

Server discard of a later accidental cleanup remains safe: claimed ids return `E_ASSET_IN_USE` and `discardAutomaticUploads` swallows that.

## What looks correct (not findings)

- **Ownership / oracle:** `unclaimed_uploads` filters `created_by`. Discard of a foreign or missing id returns `{ discarded: false }`. Own claimed id is `E_ASSET_IN_USE` (`assets_ledger.rs:432-445`). HTTP test covers Alice/Bob + restart.
- **Claim vs discard:** Immediate `UPDATE … locator_table IS NULL`, then locator check in the same transaction. Claim goes through `validate_asset_use` (`reclaiming` → `E_ASSET_NOT_READY`). Finalize `reserve`/`ready` require `reclaiming = 0`. Core test fences late reserve/claim.
- **Quota:** `reclaiming = 1` drops the row from usage immediately. `AssetUploadAuthorize` calls `enforce_staging_caps` before the body is read (`writer_assets.rs:234-237`, `asset_http.rs:146-155`). Begin still charges again.
- **Sweep / inflight bytes:** Discard only tombs and inserts `pending_asset_deletes`; it does not enumerate blobs. Boot/`reclaim` selects `reclaiming = 1` without waiting 24h; `finish_asset_reclaims` deletes the row after the fork-aware sweep. Crash between tombstone and pending insert is recovered on boot. Staging files still drop via `StagingFile`.
- **HTTP:** `GET /api/uploads` / `POST /api/uploads/discard` use `resolve_authority` (anonymous → `E_AUTH_REQUIRED`; carrier identity is not produced on these routes). Page size 100 + `next`. `E_ASSET_TOO_LARGE` is `422` on upload with rewrite naming `listUploads`/`discardUpload`.
- **SDK keep-bytes:** Ambiguous HTTP 200/422/503 bodies, lost committed mutation, and `state === "queued"` do not discard. Kind-mismatch on two-phase `upload()` does discard. Supplied records are not in `records[]`. Cleanup failures do not replace the original result/error.

Focused core/SDK/HTTP/real-owner tests reported passing were not re-run. They do not cover File substitution + outbox admission failure.

## Observations (non-blocking)

- **`listUploads` is the staging-quota set, not “never referenced.”** Released-but-still-in-grace assets (`locator` null, `ready`, `reclaiming = 0`) appear and can be discarded immediately, skipping the 24h replacement grace in LLP 1006 §9. That is the right set for quota recovery; a bulk “discard everything in the list” UI would also collect recently replaced avatars. The operator guide already says only discard abandoned pending/queued work.
- **`E_ASSET_IN_USE` on discard is HTTP 400** (`refusal_status` default). Upload asset input errors are 422. Clients key off `code`; aligning discard to 422 would match the rest of the asset surface.
- **Claim SQL does not repeat `reclaiming = 0` in the `UPDATE`.** `validate_asset_use` in the same mutation transaction plus the sole writer make the race academic; adding the predicate would be defense in depth only.
- **`RuntimeError::AssetTooLarge` via `from_runtime`** now uses the inner message (no `E_ASSET_TOO_LARGE: ` prefix) and a staging-recovery rewrite for every `AssetTooLarge`, including column-bound oversize on the upload/authorize path. Mutation execute still maps it to a rejected result through `mutation_rejection_code`.
- **No pagination test** (`after`/`next`); the HTTP test fills 20 objects against a page size of 100. Not a functional defect.

Do not ship until finding 1 is fixed and covered. No unrelated redesign is required.
