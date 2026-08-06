# `verify_attachment`'s cross-owner refusal has no negative test

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 5
**Systems:** Assets, Storage, Testing
**Date:** 2026-08-06
**Related:** LLP 0044 (asset storage pipeline), LLP 0180 (the asset-bearing
command whose whole safety story rests on the mutation's commit-bound
attachment check)

## Summary

`assets::verify_attachment` (`src/assets.rs:1614`) is the commit-bound
attachment check every declarative `v.assetRef` write goes through
(`src/storage.rs:17570`). It has four refusal branches. Three are covered by
negative tests; the ownership branch is not:

| Branch | Code | Negative test |
| --- | --- | --- |
| app-boundary crossing | `SNAPBACK_ASSET_ATTACH_DENIED` | yes |
| intent restriction mismatch | `SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH` | yes (`src/local.rs:34126`) |
| unavailable asset | `SNAPBACK_ASSET_ATTACH_UNAVAILABLE` | yes (`src/local.rs:34165`) |
| **caller principal ≠ `asset.owner_principal`** (`src/assets.rs:1668`) | `SNAPBACK_ASSET_FORBIDDEN` — "attachment caller is not the asset owner" | **none** |
| **no caller principal on a non-`Seed` write path** (`src/assets.rs:1678`) | `SNAPBACK_ASSET_FORBIDDEN` — "attachment requires a caller principal" | **none** |

`SNAPBACK_ASSET_FORBIDDEN` is asserted in ~20 places in `src/local.rs`, but
every one of them exercises a different function (reservation, transfer,
finalization, inspection, host ops). Searching for either of the two message
strings above returns only the definition site. So the one check that stops
principal A from attaching principal B's finalized bytes to A's own row is
carried by no test.

## Why it matters

This is the check that makes the LLP 0180 command safe: the command never
attaches anything itself, it just passes an `assetRef` to an ordinary mutation
and lets the commit-bound check decide. If the ownership branch regressed —
inverted comparison, an early `Ok`, a refactor that stops threading
`authority.principal` — every existing attach test would still pass, and the
failure mode is silent cross-tenant attachment rather than a crash.

## Fix

Add two unit cases beside the existing `verify_attachment` negatives in
`src/local.rs` (same fixtures as the `SNAPBACK_ASSET_ATTACH_INTENT_MISMATCH`
case at 34126):

1. finalize an asset owned by principal A, then attempt the declarative write
   as principal B; assert `SNAPBACK_ASSET_FORBIDDEN` and that the row is not
   written;
2. attempt the same write with no caller principal on a non-`Seed` write path;
   assert `SNAPBACK_ASSET_FORBIDDEN`.

Pre-existing; not introduced by the LLP 0180 command work. Found by the G3
adversarial review while tracing what actually guarantees the command's
attachment safety.
