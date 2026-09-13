# Snapback 4: Releasing before claiming makes asset moves always refuse

Status: Closed
Severity: major
Priority: P1
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

`write.rs:195-203` releases the old asset home *before* claiming the new
one:

```rust
if let Some(released) = before { self.tx.release_asset(&released, now)?; }
if let Some(claimed) = after { ... self.tx.claim_asset(&claimed, ...) }
```

But `claim_asset`
([assets.rs](../../snapback4/crates/snapback4-core/src/assets.rs):354-371)
refuses any asset with `released_at` set — with the misleading
`E_ASSET_UNKNOWN` ("no upload of yours is named {id}; upload the bytes
first"), which describes a never-uploaded asset, not a just-released one.
Consequences:

1. Moving an asset across rows (set row2.photo to the id row1.photo held)
   releases then claims the *same* id, so the claim always refuses:
   cross-row moves can never succeed.
2. Clearing a photo column then re-setting the same upload later refuses
   with `E_ASSET_UNKNOWN`, telling the user to re-upload bytes the server
   still holds.

Distinct from `20260913-snapback4-view-once-records-before-bytes` (view
accounting order) and `20260913-snapback4-asset-once-and-pixel-bounds`
(uploader bypass, dimension caps).

## Implementation locations

- [crates/snapback4-core/src/assets.rs](../../snapback4/crates/snapback4-core/src/assets.rs) (`claim_asset`, `release_asset`)
- [crates/snapback4-core/src/engine/write.rs](../../snapback4/crates/snapback4-core/src/engine/write.rs) (release-before-claim order)

## Suggestion

Claim before releasing (skip the release when `before == after` targets a
new home, transferring the home instead), and return a distinct code
(e.g. `E_ASSET_RELEASED`) when a claim names a released asset. Add tests:
move asset row A -> row B succeeds; clear-then-reset succeeds; genuinely
unknown id still yields `E_ASSET_UNKNOWN`.

## Resolution — 2026-09-13

Release detaches the prior home while retaining the ledger until collection. A subsequent claim can establish a new home and clears released_at. The regression covers moving within a transaction, clearing and reclaiming before collection; unknown/collected assets still refuse.

Integrated implementation: `4b70bdb6f` and `3d2007794`, plus the HTTP/device follow-ups where applicable. Focused core, simulator and host regressions passed. Full integrated suite and scoped blind review are recorded in the append-only Snapback4 journal before publication.
