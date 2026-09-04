# Snapback 2 byte cache: the asset record shape is a closed key set

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/store/byte-cache.ts`)
**Date:** 2026-09-04
**Related:** LLP 1012 §9 implementation record; LLP 1006 §9b; review `o4w-r2-muse.md` M2

## What happened

`assetRecordId` recognizes an asset record only by its exact key set (`height, id, width`
or `duration, height, id, width`). Any extra field a future media column carries (a brand,
a mime type, a poster) makes the walk return `undefined`, so `leasedAssets`, the `put`
lease check, and the purge in `applyByteSwap` all stop seeing the id: puts become
`unleased` and the purge misses the bytes. The O4-web fix round fixed the per-row
view-once half of grok's finding; this closed-shape half was declined for the lane.

## Resolution wanted

Walk the declared asset columns from the schema (the certificate knows which columns are
assets) instead of matching a record's key set, before the next media field lands. Add a
test that an asset record with an extra field still leases, purges, and refuses view-once.
