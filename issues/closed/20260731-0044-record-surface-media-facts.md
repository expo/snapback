# Client record surfaces omit rendition media facts (placeholder, dims)

**Status:** OPEN — found by the Lane-1 conformance work (2026-07-31);
owner: core lane

`GET /assets/records/{id}` and the reserved `_snapback.assetRecord`
projection rows carry only `{assetId, availability, deliveryProfile,
primaryRenditionId, lifecycleGeneration, createdAtMs, updatedAtMs}`
(src/local.rs asset_record_inspect / asset_record_projection). Renditions
and their typed media facts — `placeholder: {algo: "thumbhash.v1"}`,
`dominantColor`, width/height — are not client-readable, so an app cannot
obtain the ThumbHash value the React renderer ladder is designed to show
(today it must arrive out-of-band as a prop), and declarative variant
discovery is delivery-only.

Fix: project the authorized asset's rendition list (variant key, width,
height, safe media facts — never blob keys or staging identifiers) into
both surfaces, moving the read dependencies with it so live updates fire
on rendition publication. The conformance suite's vector-1 comment marks
the assertions to strengthen when this lands.

---

**RESOLVED 2026-07-31** (Lane-2 interrupt cluster, commit dbe83360).
`AssetRecordClientViewV1` (Rust-owned, `schemas/asset.record-view.schema.json`)
now backs both `GET /assets/records/{id}` and the reserved live
projection: rendition summaries `{variant, ready, width?, height?}` plus
the primary's typed media facts including the ThumbHash placeholder and
detected mediaType — never blob keys or staging identifiers. The
projection's synthetic dependency carries the summaries and facts, so a
rendition arrival moves the delivery fingerprint
(`asset_record_projection_fingerprint_moves_when_renditions_land`).
Client-side consumption of server-provided placeholders is the noted
Lane-1 follow-up (`useSnapbackAssetImage` currently takes the
placeholder as a prop).
