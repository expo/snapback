# Torn-`planned` publication cleanup deletes the object before committing condemnation

Status: Open
Created: 2026-08-21
Related: issues/shelved/20260821-durable-authority-to-effect-handoff-design.md, LLP 0044

## The defect

`crates/snapback-engine/src/local/engine.rs`, the non-redrivable torn-put branch of the
`Planned` publication maintenance loop:

```rust
if !re_drivable {
    if store.exists(object)? {
        // The object exists but does not verify: a torn put.
        store.delete_blob(&record.planned_key).ok();   // physical delete
        report.objects_deleted += 1;
    }
    self.db
        .asset_maintenance()
        .publication_condemn_not_redrivable(&mut record, attempt.as_ref(), now_ms)?;  // authorizing commit
    report.condemned += 1;
}
```

The physical delete precedes the durable record that authorizes it. Every sibling loop does the
opposite. The `Condemned` cleanup loop in the same function operates on records whose condemnation
is already durably committed, and only then deletes:

```rust
// Condemned records: delete the object (if any), then retire.
...
if store.exists(object)? && !owned_by_blob {
    store.delete_blob(&record.planned_key)?;
}
self.db.asset_maintenance().publication_retire_condemned(&record, now_ms)?;
```

This matters beyond tidiness: the durable-authority-to-effect handoff rule is that an irreversible
physical act is performed FROM a committed record, never before one. This branch inverts that.

## Second issue: the missing live-blob guard

The `Condemned` loop refuses to delete an object that a live blob row owns:

```rust
// Never delete an object a live blob row owns (the reused-path
// convergence shares digests, not keys, so this is exact).
let owned_by_blob = self.db.asset_maintenance()
    .publication_key_owned_by_live_blob(&record.planned_key)?;
```

The torn-`planned` branch has **no such check**. It calls `delete_blob(&record.planned_key)`
unconditionally when the object exists. Whether a live blob row can own a torn `planned_key`
needs confirming — if it can, this is a data-loss path, not only an ordering wart.

## Fix

Reverse the order in the torn branch: commit `publication_condemn_not_redrivable` first and let
the existing `Condemned` loop perform the delete on a subsequent pass.

That shape is preferable to simply moving the delete after the commit, because it also inherits
the `owned_by_blob` guard for free instead of duplicating it. Deleting one pass later is
acceptable — the object is already known not to verify.

## Recovery note

The current code is largely self-healing: a crash between delete and condemnation leaves the
record `Planned` with no object, and the next pass re-enters the same branch and condemns. It
stops self-healing if the attempt becomes re-drivable in the interim, which leaves a `Planned`
record whose object was already destroyed. That window is the concrete harm from the ordering.

## Provenance

Found by read-only design analysis of irreversible-effect authority handoff; the ordering claim
and the sibling-loop contrast were then verified directly in source. The missing `owned_by_blob`
guard was found while verifying and is not part of that analysis.
