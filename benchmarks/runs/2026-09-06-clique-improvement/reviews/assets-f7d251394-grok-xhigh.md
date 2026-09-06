I'll run a read-only review of this Snapback2 abandoned-upload recovery revision: first the review skill and snapshot layout, then the patches, LLP1006, and only our prior grok notes.This is a snapshot review, not a GitHub PR review. I’ll load LLP1006, the patches, and only `prior-grok.md`, then inspect the changed source and tests.Prior grok residual was the 200 `E_AUTH_SESSION` discard leak. Next I’ll read both patches and LLP 1006 recovery clauses, then trace the claimed residual fixes in source.I’ll inventory both patches and then read the custody, finalizer, and mutation-cleanup paths that the residuals named.I’ll extract the full revision patch and read the client, blob-store, and writer paths that implement the three claimed residual fixes.The revision reordered expiry, fetch-boundary custody, and finalizer hand-back. I’ll read those implementations and their tests next.401-on-mutation still expires inside `json()`; I’ll check whether the server actually returns that, or only the 200 rejected shape the residual named.The 200-session and stringify-before-fetch residuals look closed. The remaining issue is that a failed staging unlink is now fatal to the owner writer, which I’ll cite with file/line and a reproduction.

# CHANGES_REQUIRED

Independent read-only review of `f7d251394` vs `a897055f8` (revision from `2e671c5c6`). Supporting source, tests, LLP 1006 (r), `change.patch`, `revision.patch`, and only `prior-grok.md` were read. Tests were not executed.

Two of the three named residuals are resolved in source: wire custody is marked only at the fetch boundary after `JSON.stringify` and local checks, and a 200 `E_AUTH_SESSION` mutation result now discards with the mutation bearer before `expireSession`, while `validated(authority)` still runs before cleanup. The finalizer hand-back does return a failed unlink to `UploadCustody`, but the sweep retries that unlink with `?` on the sole writer’s 60s timer. That turns a per-id staging IO failure into process death and blocks sibling reclamation. The new unit test asserts the error and does not exercise the writer loop, so the reported 99 JS / 62 Rust passes cannot have caught it.

## Prior residuals

**1. Serialize all local inputs before wire custody at fetch boundary — resolved in source.** `submitMutation` stringifies before `json()` (`client-outbox.ts:83-88`). `json()` runs abort/authority/offline/`headers()` first, then `onSend` immediately before `fetchImpl` (`client.ts:807-815`). Cyclic/`TypeError` paths never mark `"wire"`, so `withMutationUploads` discards (`client-upload.ts:131-137`). Tests exist at `assets.test.ts:643-671` and `real-owner.test.ts:101-126` (not re-run).

**2. Terminal 200 mutation refusal keeps bearer through cleanup — resolved in source.** `expireSession` runs after `withMutationUploads` returns (`client.ts:282-303`). Cleanup 401 that already cleared the token is a no-op (`expireSession` returns `{ cleared: false }` at `client.ts:1255-1256`); `expiration.cleared &&` avoids replacing the settled rejection with `E_AUTH_SUPERSEDED`. Tests at `assets.test.ts:730-757` (not re-run).

**3. Finalizer worker hands failed deletion back to retryable custody — incomplete.** `finish(finalizing)` puts the file back before `discard()` (`blob_store.rs:495-508`). That part is right. Sweep then calls `cancel_upload(id)?` (`writer_assets.rs:93-98`), and `drive` treats any `sweep_assets_if_due` error as fatal (`writer_jobs.rs:9-34`, `69-75`). That is a new outage, not a retry.

## Material findings

### 1. Failed staging unlink on a retryable id stops the owner and skips sibling GC

- **Where:** `snapback2/crates/snapback2/src/writer_assets.rs:93-98` with `writer_assets.rs:77-82`, `writer_jobs.rs:9-34` / `69-75`, `blob_store.rs:484-508`, and `writer_assets.rs:218-222`
- **What is wrong:** After the worker exits, a failed `remove_file` leaves `cancelled = true`, `finished = false`, and the `StagingFile` in `receiving`. Explicit `discard_upload` inserts the id into `pending_asset_deletes` and then `cancel_upload?` (`writer_assets.rs:218-222`). Grace reclaim does the same via `sweep_assets_now`. The next due sweep (60s, `writer.rs:415`) calls `cancel_upload` again. On another unlink failure the `?` returns `E_OWNER_ASSET_IO` from `sweep_assets_if_due`. `drive` logs `"background turn failed"` and sets `stop`, so the sole writer exits.

  Previously `upload_active` was a non-IO `finished` check: a stuck id was skipped and other pending deletes still ran. The residual asked for retry, not for promoting per-id staging IO onto the writer-fatal path. LLP 1006 §9 says failed deletion returns the path “for disposal or grace-sweep retry.”

  The same `?` also aborts the rest of that sweep: one stuck file prevents blob GC and `finish_asset_reclaims` for every other pending id.

- **Repro:** The revision’s own unit test already produces the error (`writer_assets.rs:747-828`, `dispose = false`):
  1. Begin an upload, `finalize()`, chmod `.snapback/staging` to `0o500`.
  2. Worker `finish(Some(file))` returns `E_OWNER_ASSET_IO`; path remains; usage stays 100.
  3. Advance past grace and call `sweep_assets_now()` → `E_OWNER_ASSET_IO` (asserted at line 828).
  4. In a live owner that same return is `sweep_assets_if_due` → `fail()` → writer gone. Later `OwnerHandle.call` fails. Queries, mutations, and uploads stop. A second ready unclaimed id in `pending_asset_deletes` is never swept.

  Same fuse without the test chmod if unlink fails for a closed staging file (read-only remount, directory perms, `EIO`): upload `finish_bytes` returns 500 (`asset_http.rs:331-334`); row stays `receiving` and charged; discard or 24h grace puts the id on `pending_asset_deletes`; the next 60s timer kills the owner. Sticky perms also make `LocalStaging::open`’s `sweep_named_temporaries` fail, so restart does not recover.

  I did not run this through `drive`; the fatal composition is from those call sites.

- **Fix direction (scoped):** Keep the hand-back. Do **not** `?` per-id `cancel_upload` inside `sweep_asset_blobs`. Treat `Err` like `Ok(false)`: leave that id pending and charged, continue sibling deletes, retry next interval. Keep returning `E_OWNER_ASSET_IO` from explicit `discard_upload` so a caller who asked for disposal still sees IO failure. Change the unit test so sweep-while-unlink-fails stays `Ok`, usage and path remain, then chmod and a later sweep/disposal actually release. A drive-loop assertion that the writer is still alive is optional coverage, not a substitute for the `?` fix.

Do not ship until finding 1 is fixed. No unrelated redesign is required.

## What looks correct (not findings)

- **Wire custody vs local throw:** `JSON.stringify` / `structuredClone` / grant / prediction all precede custody. Outbox `beforeCommit` remains immediately before `store.commit` (`outbox.ts:358-364`). Ambiguous HTTP 200/422/503 bodies still keep bytes (`assets.test.ts:673-688`).
- **200 `E_AUTH_SESSION` cleanup:** Discard uses `Authorization: Bearer session` before expiry. Cleanup 401 still expires and still returns the mutation rejection (`assets.test.ts:730-757`). `validated(authority)` remains inside `submit` before cleanup (`client.ts:290-293`).
- **401 `/api/mutation`:** `refusal_status` maps `E_AUTH_SESSION` to 401 (`serve.rs:837-838`); `resolve_authority` runs before execute (`writer.rs:984`). A dead server session cannot discard with the same bearer. That is lost-credential recovery via `listUploads` after re-login, not the 200 hole the residual named.
- **Hand-back itself:** `finish` restores the file before `discard`; failure does not set `finished` or drop the path. Running finalizers have `receiving = None`, so `cancel` returns `false` and sweep leaves them charged (`writer_assets.rs:693-745`).
- **Ownership / quota:** `unclaimed_uploads` and usage count the caller’s unlocated receiving rows (including `reclaiming = 1`) and ready rows with `reclaiming = 0` (`assets_ledger.rs:247-259`, `403-446`). Foreign/missing discard is `{ discarded: false }`; claimed is `E_ASSET_IN_USE`. HTTP restart test still covers Alice/Bob (`recovery.rs:4-136`).
- **In-progress discard:** `copy_from` drops the mutex across `read` and refuses writes if `cancelled` (`blob_store.rs:435-465`). Paused-body HTTP test still requires unlink before quota release (`recovery.rs:143-225`).

Focused JS/Rust checks reported passing were not re-run.

## Observations (non-blocking)

- **Optional coverage:** no test that one failed unlink leaves sibling pending ids deletable; no `drive` test that the writer survives `E_OWNER_ASSET_IO`; no `after`/`next` pagination test (HTTP fill is 20 vs page size 100).
- **HTTP 401 File mutation** still expires inside `json()` before catch-path discard; against this owner the discard would 401 anyway. A mock 401-with-still-valid-token test would only document lost-credential recovery.
- **`RuntimeError::AssetTooLarge` via `from_runtime`** still attaches the staging-recovery rewrite to every oversize, including column-bound authorize/begin (`protocol.rs:137-146`).
- **Paused sockets still occupy the 4 upload workers** until the client writes or closes; staging quota is released, occupancy is not. Pre-existing, more visible now that in-progress discard is supported.
