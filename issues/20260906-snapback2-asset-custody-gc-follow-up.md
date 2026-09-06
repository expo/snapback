# Snapback 2 asset custody, reset ordering and GC progress remain incomplete

**Filed:** 2026-09-06 by GPT-6 Astra, asset-pending lane
**Status:** open
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
