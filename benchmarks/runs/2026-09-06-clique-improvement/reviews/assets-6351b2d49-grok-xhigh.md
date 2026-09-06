I'll do a read-only review of this Snapback2 abandoned-asset revision: start with the scoped patches, my prior grok notes, LLP 1006, and the relevant source/tests.The snapshot is in place. I'll load the review prompt, my prior grok notes, LLP 1006, and the two scoped patches first.Prior grok flagged a fatal per-id unlink on the writer path. I'll read the writer-revision patch and LLP 1006 next, then trace the claimed fix.I'll finish the JS half of `revision.patch` and then trace the writer, discard, and custody paths in source.I'll read the writer sweep, discard, drive loop, and the JS superseded-custody path next.I have the sweep change; next I’ll read `cancel`/`finish`, the full unlink test, and the JS custody/expiry helpers.Checking one last quota path: whether `asset_mark_failed` could release charge before unlink succeeds.# READY

Independent read-only review of snapshot `assets-6351b2d49` (`writer-revision.patch`, `revision.patch`, LLP 1006 (r), only `prior-grok.md`, plus the cited source/tests). `change.patch` used as context. Tests were not executed. Other reviews were not read.

The prior grok residual is closed. The writer sweep no longer promotes per-id staging unlink IO onto the sole-writer fatal path. Explicit discard still returns `E_OWNER_ASSET_IO`. The JS superseded-terminal path invalidates captured custody without clearing a successor.

## Prior residuals

**1. Serialize before wire custody** — still closed. `submitMutation` stringifies before `json()` (`client-outbox.ts:84-87`). `onSend` runs immediately before `fetchImpl` (`client.ts:820-821`).

**2. Terminal 200 `E_AUTH_SESSION` keeps the bearer through cleanup** — still closed when no concurrent transition has bumped the fence. `validated` still runs inside `submit` before `withMutationUploads` discard (`client.ts:292-299`); the outer `expireSession` still runs after discard (`client.ts:301-307`). Cleanup 401 on an already-cleared token is a no-op (`expireSession` `cleared: false` at `client.ts:1261-1262`).

**3. Failed staging unlink must not kill the owner or sibling GC** — closed in this writer revision.

## Writer fix (the residual)

`sweep_asset_blobs` now treats per-id `cancel_upload` failure as “not ready”:

```93:99:snapback2/crates/snapback2/src/writer_assets.rs
        for id in &self.pending_asset_deletes {
            // Running finalizers and failed unlinks stay pending and charged.
            // Retry next interval without stopping the writer or sibling GC;
            // explicit discard still reports the per-upload I/O refusal.
            if matches!(self.staging.cancel_upload(id), Ok(true)) {
                deletable.insert(id.clone());
            }
        }
```

`Ok(true)` (unlinked, or no custody) enters blob GC. `Ok(false)` (running finalizer) and `Err` (unlink IO) stay in `pending_asset_deletes`. There is no `?`, so the loop continues.

Explicit discard is unchanged and still surfaces IO:

```219:224:snapback2/crates/snapback2/src/writer_assets.rs
        if discarded {
            self.pending_asset_deletes.insert(id.to_owned());
            // Receiving tombstones remain charged until the shared handle has
            // closed/unlinked staging, or the finalizer reports physical release.
            if self.staging.cancel_upload(id)?
```

The insert happens before `?`, so a failed explicit discard still leaves the id pending for the next sweep.

### Error classification

`StagingFile::discard` maps unlink failure to `E_OWNER_ASSET_IO` / family `owner` / site `assets/storage` (`blob_store.rs:521-527`, `723-730`). `UploadCustody::cancel` / `finish` propagate that and, on `?`, leave `receiving` in place and `finished` false (`blob_store.rs:484-508`). `cancel_upload` has no other `Err` class.

Background: `sweep_assets_if_due` → `sweep_assets_now` → `sweep_asset_blobs` no longer returns that error. `drive` only `fail()`s / sets `stop` when the preparation `Result` is `Err` (`writer_jobs.rs:9-34`, `69-75`). Per-id staging unlink no longer takes that path.

Client-facing: `discard_upload` still returns `E_OWNER_ASSET_IO`. The unit test asserts that on `dispose = true` (`writer_assets.rs:889-890`).

### No premature quota release

Usage still counts `state = 'receiving'` even when `reclaiming = 1` (`assets_ledger.rs:247-250`). `mark_asset_failed` (which would drop the row out of that predicate) runs only after `cancel_upload` returns true (`writer_assets.rs:223-233`). Failed unlink never reaches `finish_asset_reclaims`, so the blob and ledger row stay. The test asserts `(charged, still_charged) == (100, 100)` and `retained` (path exists, blob readable, id still pending) before the chmod repair (`writer_assets.rs:843-867`).

### Writer stays live; siblings reclaimed; repair completes

The same test now drives the real loop: one `Action::Status` on a closed admission channel, `next_asset_sweep = Instant::now()`, then `writer_jobs::drive` (`writer_assets.rs:825-838`). It asserts `!stopped`, the queued read is served, the ready sibling is gone from ledger/blob/pending, and the failed id stays charged. After `0o700`, discard (dispose arm) plus `sweep_assets_now` unlinks, drops usage to 0, and removes blob and row (`writer_assets.rs:852-888`).

`once_state` does not start a writer thread (`writer_assets.rs:450-508`), so the in-test `drive` is the failure boundary.

LLP 1006 §9 now matches this: failed deletion retains path and charge; sweeps skip that id without stopping the writer or siblings.

## JS superseded terminal custody (`revision.patch`)

`transition()` increments `operationFence` synchronously (`client.ts:1222`). A `subscribeStatus` login started from `json()`’s `patchSnapshot({ connection: "connected" })` (`client.ts:904`) therefore makes `validated(authority)` throw `E_AUTH_SUPERSEDED` after a 200 `E_AUTH_SESSION` body has already been returned. Previously that throw skipped the outer `expireSession`.

The catch expires the **captured** authority, then rethrows (`client.ts:292-297`). `expireSession` does not check fence; it no-ops unless `currentToken` and `custodyGeneration` still match (`client.ts:1261-1262`), so a successor install is not cleared. Login waits on `settleWrites` (`client.ts:1231`), so the mutation’s `expireSession` runs first and the replacement dispatch sees a null bearer. Covered by `auth-ownership.test.ts:831-879` (replacement success and failure). Tests not re-run.

## Optional coverage (not blocking)

- Automatic mutation uploads in the status-listener 200-session race: `discardUploadFor` uses `json(..., enforceAuthority=true)` (`client-upload.ts:82-85`, `54`). After the fence bump, discard throws superseded and is swallowed (`client-upload.ts:97-98`). Abandoned ids remain recoverable via `listUploads` / grace (LLP 1006 §10). Same shape as an earlier `transition()` before the 200 body (`client.ts:897-899`). Not a regression of residual 2.
- Sibling in the Rust test has no staging file (ready blob only). That is enough to prove the sweep no longer `?`-aborts; it does not simulate two staging unlinks with different outcomes.
- Skipped unlink errors are not logged.

No material defect in the changed delta. Do not ship a further writer pass for finding 1; it is fixed.
