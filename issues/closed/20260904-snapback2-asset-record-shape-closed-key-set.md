# Snapback 2 byte cache: the asset record shape is a closed key set

**Status:** Closed — not a defect under the accepted closed-record contract
**Priority:** P3, activates only with an accepted asset-record extension
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

## Reconciliation — 2026-09-11

This is not a latent dynamic-field-recognition fix. LLP 1006 §1 deliberately defines a
closed image record `{ id, width, height }` and video record `{ id, width, height,
duration }`; §6 rejects extra fields. Current `byte-cache.ts::assetRecordId` implements
that exact contract and names it in its `@ref`. A brand, MIME field, or poster would be a
new asset type/record contract, not a valid current record the cache must discover.

There is therefore no current malformed-record bug to reproduce. The forward-compatibility
request is retained because LLP 1006 does not permanently forbid a later accepted record
extension. Its next acceptance starts only when such an extension is proposed: decide
whether the certificate/schema should direct walking, then update validation, wire values,
lease/purge behavior, and view-once tests together. No claim is made that arbitrary or
future fields are recognized today.

## Resolution — 2026-09-11

The user delegated the remaining design choices for this queue. This speculative
compatibility request is closed without a code change: LLP 1006 deliberately
makes asset values closed records and requires coordinated schema, validation,
wire, cache, and view-once work for any future extension. Keeping an open defect
against invalid extra-field records would contradict that accepted contract. A
future accepted asset-record extension should file its own implementation task.
