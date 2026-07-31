# Blob record_json reference_count goes stale after release

**Status:** OPEN — found during image P-04 (2026-07-31), pre-existing
from L1

`release_blob_reference` mutates the `reference_count` *column* of
`_snapback_asset_blobs_v1` while `load_blob` decodes the row's
`record_json`, so the JSON copy of the count is stale after any release.
The column is the refcounting authority (GC eligibility and the
condemned fence read it; P-04's tests assert it), so no correctness bug
is known — but a reader trusting `record_json.referenceCount` (inspect
output, future tooling) would see a stale value.

Fix: either rewrite `record_json` in the same UPDATE, or drop the count
from the JSON shape so there is exactly one representation (preferred —
one authority, no dual write). Audit other mutated-column-vs-json pairs
in the asset tables while there.
