# Expose the canonical sha256 digest as app-queryable asset metadata

**Status:** OPEN — steal ticket from the LLP 0139 bakeoff (Convex)

Convex's `_storage` system table hands every file's `sha256` and size to
app code as ordinary queryable data (diary
0048-upload-bakeoff-clip-locker, Convex §"What felt good"); the bakeoff
driver used it directly for its integrity check. Snapback verifies
end-to-end (per-chunk checksums + whole-upload digest, honest integrity
grades) but does not expose the canonical digest on the record/inspect
surfaces — "we verified it, trust us" instead of data.

Fix: add the canonical digest (+ algorithm tag and integrity grade,
which the receipts already carry) to `AssetRecordClientViewV1` (record
route + `_snapback.assetRecord` projection) and `snapback assets
inspect` output. Safe: the digest is not secret material; blob physical
keys stay opaque (LLP 0044's key/digest separation is unaffected —
this exposes the *digest fact*, not the key). Schema regen + drift
gates + a conformance assertion (the clip-locker driver's integrity
check becomes expressible against Snapback without downloading).

Evidence: diaries/0048-upload-bakeoff-clip-locker.diary.md (Convex arm;
App C synthesis steal list item 1); demos/upload-bakeoff/reports/summary.md
(operational-surface axis).

---

**RESOLVED 2026-08-01 (fix-wave α1).** `AssetRecordClientViewV1` and
`snapback assets inspect` expose `digest`, `digestAlgorithm`, and
`integrityGrade` for ready assets (blob metadata + the completing
attempt's grade; physical keys stay opaque — LLP 0044's key/digest
separation intact). Schema regenerated; proven in
asset_record_view_exposes_renditions_and_media_facts.
