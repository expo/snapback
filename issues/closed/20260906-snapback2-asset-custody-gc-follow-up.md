# Snapback 2 asset custody, reset ordering and GC progress follow-up

**Filed:** 2026-09-06 by GPT-6 Astra, asset-pending lane
**Status:** Closed — bounded sweep and failure-inclusive scratch custody landed 2026-09-11
**Priority:** P1
**Scope:** inherited physical cleanup/custody defects; separate from pending-object classification
**Related:** LLP 1006 §9/§9a/§14; `20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md`

Root's 2026-09-06 decision repairs successful releases consuming pending upload
slots, preserving the existing original-byte admission query. It rejects the
broader release/reset admission policy. This ticket does not propose ordinary
delete/replacement refusals, shortened grace, early rung/view-history deletion,
new limits, or a new reset capacity gate.

## Evidence and disposition

Decision and implementation receipts:
`/Users/ccheever/clique-improvement/revisions/asset-pending-r1/`
(`root-decision.md`, `source-before.json`, `source-receipt.json`,
`implementation-report.md`, `receipts/`). Independent design critique:
`/Users/ccheever/clique-improvement/reviews/asset-grace-policy-final-astra/review.md`
and `findings.json`; reviewed `policy-design.md` SHA-256
`919cb51431bb5c2253b744a31fcb6d6eb29a04f516fcaa8708fc308ff9801f4c`.
That critique was static: it ran no tests and qualifies no runtime or disk bound.
Its source baseline is 0.0.10 snapshot `967f857e66b504dcea6286f10565c80fd2bf7d64`;
this lane independently inspected the current paths below (hashes in receipts).

- **F1/F2 are rejected product choices**, not implementation bugs waived for
  passing tests: an indivisible live footprint could become permanently
  undeletable, and destructive reset would lose its recovery role.
- **F3's new capacity-refusal bug is avoided** by adding no such refusal.
  The inherited reset ordering below still needs repair.
- **F4's proposed exact foreign/owner headroom is not added.** Public usage and
  listing stay creator-scoped. No existing implementation leak was alleged.
- **F5's full-sweep and failure-progress gaps remain open.** No bounded sweep,
  finite physical-storage envelope, or completed custody repair is claimed.
- Grok's earlier final-design delta review was outstanding at root's decision;
  no Grok approval of that decision or this implementation is inferred.

## Concrete open work

1. **Admission credit precedes physical completion for ready/failed rows.**
   `assets_ledger.rs::asset_staging_usage` excludes failed rows and ready
   reclaiming tombstones; `discard_upload` sets that tombstone before
   `writer_assets.rs::sweep_asset_blobs` deletes bytes. Fork-held and failed-delete
   ready rows can therefore retain originals/rungs without an admission charge.
   Receiving cancellation retains its existing count/bytes until physical closure;
   that narrower behavior must not be described as failure-inclusive blob custody.
2. **Reset unlinks staging before transactional validation.**
   `writer_assets.rs::State::reset` calls `LocalStaging::clear` before seed-row
   preparation and `reset_and_seed_at`. `blob_store.rs::clear` directly unlinks
   directory entries without the per-upload cancellation/closure protocol.
   Existing later errors cannot restore those files; receiving/finalizing workers
   need an explicit lifetime/ordering repair. Adding no capacity refusal avoids
   the review's new trigger but does not fix this inherited order.
3. **Blob deletion errors abort sibling settlement; sweep work is unbounded.**
   `writer_assets.rs::sweep_asset_blobs` materializes every live ledger id.
   `asset_gc.rs::fork_all_references` materializes every fork ledger id;
   `sweep_asset_blobs` synchronously enumerates the directory and propagates
   `blobs.delete(key)?`. One failure skips the caller's entire finish step,
   including successful siblings. `blob_store.rs::enumerate` has no continuation;
   `assets_ledger.rs::reclaim` also selects all eligible ids. Staging cancellation
   failures are skipped per id, which does not solve blob deletion failure progress.
4. **Late rung/view work is not fenced against final GC.**
   `asset_http.rs::render_rung` publishes after rendering with no durable rung
   reservation or final ledger test; GC does not share its `MediaJobs` guards.
   `deliver_once` can consume after a body writes, while
   `assets_ledger.rs::record_asset_view` checks duplicate use but not ledger
   existence. Investigate orphan rungs/view rows with barrier-controlled races,
   preserving same-ID once history and the existing consume timing.
5. **Scratch cleanup is not a failure-inclusive budget.**
   `asset_http.rs::render_rung` ignores output unlink failures and copies the
   source before its helper permit. `blob_store.rs::StagingFile::drop` ignores
   discard failure; publish, strip and helper temporary paths likewise need an
   exact ownership audit (`media.rs::TemporaryOutput` and upload finalization paths).
   Four uploads/two helpers/64 HTTP workers alone do not prove retained scratch
   bounds. No new footprint formula, floor, metadata charge or reservation
   framework was implemented by the pending-slot patch.

Follow-up verification needs failed-unlink sibling progress, reset failure with
paused receiving/finalizing work, render/once completion versus GC, durable
restart recovery, fork retention, and scratch ownership under failure. Measure
whole-turn work separately; small regression fixtures do not qualify disk
amplification or latency at large live/fork cardinalities. Preserve ordinary
release liveness, full grace, affine/creator authority and stable replay terminals.

## Reconciliation and fresh reproductions — 2026-09-11

Current source still has all five categories above. Two priority failures were reproduced
on BLACK at current `15c134d056`; the scratch assertions were removed afterward.

### Reset removes physical staging before later seed refusal

The probe extended existing
`tests/owner.rs::reset_seed_refusal_is_atomic_and_keeps_the_owner_running`.
`triage-reset.stage` is a synthetic owned marker placed in the staging directory; it is
not an active receiving/finalizing upload and does not qualify those worker races:

```diff
 let log_start = fs::metadata(&log_path).unwrap().len();
+let staged = root.join(".snapback/staging/triage-reset.stage");
+fs::write(&staged, b"owned reset-order probe").unwrap();
 ...
 assert_eq!(reset.body["code"], "E_CONSTRAINT", "{}", reset.body);
+assert!(staged.exists(),
+    "a reset refused during seed validation must not have removed physical staging bytes");
```

```text
cargo test -p snapback2 --test owner reset_seed_refusal_is_atomic_and_keeps_the_owner_running -- --exact --nocapture
# assertion failed: staging bytes must remain; 0 passed, 1 failed; exit 101
```

The owner returned `400/E_CONSTRAINT` and kept durable rows, but the staging file was
absent because `writer_assets::State::reset` calls `LocalStaging::clear` first.

### One blob-delete error aborts a later sibling

Here is the complete temporary patch that was compiled and run. Apply it inside the
existing `#[cfg(test)] mod tests` in `asset_gc.rs`, immediately after `ID`. Existing
imports `use super::*` and `use crate::blob_store::{BlobStore, FileBlobStore}` supply
`BTreeSet`, `Refusal`, `asset_io`, and `BlobStore`; all other names are fully qualified.
Both ids satisfy the real asset-id shape. The fake performs no filesystem writes, so its
synthetic `root` creates nothing and needs no cleanup.

```diff
 const ID: &str = "s2id-00000000000000000000000000000006-0000000000000001";
+const SIBLING_ID: &str = "s2id-00000000000000000000000000000006-0000000000000002";
+
+struct FirstDeleteFails {
+    deleted: std::sync::Mutex<Vec<String>>,
+}
+
+impl BlobStore for FirstDeleteFails {
+    fn put(&self, _key: &str, _source: &mut dyn std::io::Read) -> Result<u64, Refusal> {
+        unreachable!("triage probe does not publish")
+    }
+
+    fn get(
+        &self,
+        _key: &str,
+        _range: Option<crate::blob_store::ByteRange>,
+    ) -> Result<crate::blob_store::BlobRead, Refusal> {
+        unreachable!("triage probe does not read")
+    }
+
+    fn delete(&self, key: &str) -> Result<(), Refusal> {
+        if key == ID {
+            return Err(asset_io("injected first deletion failure"));
+        }
+        self.deleted.lock().unwrap().push(key.to_owned());
+        Ok(())
+    }
+
+    fn enumerate(
+        &self,
+        _prefix: &str,
+        visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
+    ) -> Result<(), Refusal> {
+        visitor(ID)?;
+        visitor(SIBLING_ID)?;
+        Ok(())
+    }
+}
+
+#[test]
+fn triage_delete_failure_does_not_abort_sibling_progress() {
+    let root = std::env::temp_dir().join("snapback2-asset-gc-triage-sibling");
+    let blobs = FirstDeleteFails {
+        deleted: std::sync::Mutex::new(Vec::new()),
+    };
+    let ids = BTreeSet::from([ID.to_owned(), SIBLING_ID.to_owned()]);
+    let error = sweep_asset_blobs(&root, &blobs, &BTreeSet::new(), &ids).unwrap_err();
+    assert_eq!(error.code, "E_OWNER_ASSET_IO");
+    assert_eq!(
+        *blobs.deleted.lock().unwrap(),
+        vec![SIBLING_ID.to_owned()],
+        "one failed blob deletion must not prevent a later sibling from being deleted"
+    );
+}
```

```text
cargo test -p snapback2 --bin snapback2 asset_gc::tests::triage_delete_failure_does_not_abort_sibling_progress -- --exact --nocapture
# left: []; right: [SIBLING_ID]; 0 passed, 1 failed; exit 101
```

This confirms `visitor(ID)?` / `blobs.delete(key)?` stops enumeration before the sibling;
the caller's later `finish_asset_reclaims` is also skipped by propagation. This is an
injected `BlobStore::delete` refusal, not a physical filesystem-unlink qualification.

Items 1, 4, and 5 are source-confirmed but were not race/failure-injection tested in this
bounded pass. Next acceptance: validate seed before destructive clear (including a paused
receiving/finalizing barrier); retain per-key deletion retry state while allowing sibling
progress and finishing successful siblings; then add barrier-controlled rung/view-vs-GC
and failed-scratch-cleanup tests without weakening grace or once history.

## Implementation progress — 2026-09-11

Items 1, 2, 4, and the sibling-settlement half of item 3 are repaired with
focused regressions:

- physical unlocated originals remain byte-charged through ready, reclaiming,
  and failed ledger states until cleanup actually settles;
- reset validates and commits its database transaction before requesting
  staging cleanup, and registered receiving/finalizing custody defers that
  cleanup until the worker closes;
- one blob deletion refusal is retained while successful siblings are deleted
  and their ledger reclamations are finished;
- active rung/once media jobs fence final GC, and once-view insertion requires
  the asset still to be ready and located in the same transaction.

The accepted asset LLP and operator guide now state these custody semantics.
The ticket stays open only for the unbounded enumeration/materialization half
of item 3 and the failure-inclusive scratch budget/audit in item 5. Those
remaining changes require a bounded continuation design and an exact ownership
inventory; this batch does not imply either one.

## Resolution — 2026-09-11

The remaining work landed on top of custody prerequisite `86a7342c7`:

- Core selects at most 32 ordered reclaim candidates with an explicit `after`
  continuation. The writer retains a bounded pending page instead of the full
  live ledger or reset set.
- The filesystem blob store retains an opaque `ReadDir` continuation and
  inspects at most 64 entries per turn. Fork reconciliation retains its own
  iterator, inspects at most eight fork-directory entries per reclamation turn,
  and point queries only the bounded current candidate set; reclamation never
  materializes every fork asset id.
- Original plus all twelve possible width keys are settled directly for each
  reclaim candidate. Orphan keys use the same bounded physical page. Per-key
  deletion errors remain retryable and do not block successful siblings.
- `.snapback/staging` and blob-publish temporaries each have a 32-object / 5 GiB
  physical-plus-reservation envelope (64 objects / 10 GiB aggregate scratch),
  derived conservatively from the unchanged four-upload/two-helper concurrency
  and 512 MiB owner admission ceiling. Upload rewrites and helper source/output
  work reserve before allocation; rung source copies now occur only after a
  helper permit. Retained staging and publish unlink failures remain charged
  until a later cleanup actually removes the file.
- Rung output cleanup is checked, failed image-strip cleanup is surfaced, and
  the parent helper cleanup now recognizes both the media binary's current
  `.snapback2-media-*` name and its older destination-prefixed spelling.

Permanent regressions cover 200 reset assets settling in seven 32-row turns,
17 fork ledgers advancing in three eight-entry calls, concurrent and
failed-unlink staging reservations, failed publish cleanup retaining its byte
and object charge, sibling progress, fork retention, and restart completion.
The 20/40 object caps, 256/512 MiB admission caps, full grace, affine authority,
and once history are unchanged.
