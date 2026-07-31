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

---

**RESOLVED 2026-07-31 (W2a-1, branch 0044-wave2).** Took the ticket's
preferred fix: `reference_count` and `condemned` left `AssetBlobRecordV1`
entirely — the columns are the only representation, read via the new
`load_blob_live` (record + live columns). Found en route: the two
delivery-path `!blob.condemned` filters were reading the JSON copy, which
never left `false` after insert — they were ineffective; both now consult
the live column. An idempotent open-time migration strips the legacy JSON
members so `deny_unknown_fields` keeps decoding pre-existing rows. Audit
confirmed every other asset table rewrites `record_json` in the same
UPDATE as its columns — no other stale-capable pair exists. Evidence:
`blob_mutable_state_is_single_representation_and_legacy_json_migrates`
plus the delivery suite; asset lib 77/77, artifact_schemas_v0 30/30.
