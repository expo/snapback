# Live queries cannot return v.assetRef fields (result-contract gap)

**Status:** CLOSED 2026-07-31 — AssetRef result-contract leaf shipped and
Party Wall's split-table workaround removed.

`defineLiveQuery` over any table containing a `v.assetRef` field fails
codegen: `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: unsupported result
validator {"AssetRef":…}`. The flagship feed shape — a wall of posts with
photos — is inexpressible as authored; Party Wall ships the split-table
workaround (display-copy string on the live row, typed reference in a
side table), which then also complicates seeding (placeholders resolve
only into assetRef fields).

Fix either lane: admit AssetRef leaves in the result-contract vocabulary
(serialize as the id string — the wire shape is already a string), or
teach the split-table pattern prominently in the guide's assets page with
`guide-gap` honesty. Prefer the former; the workaround costs every
consumer twice (schema + seeds).

## Resolution

The Rust-owned `ResultValueContract` and its generated JSON Schemas now admit
`{ "kind": "assetRef" }`. Codegen emits that leaf when expanding a
`v.assetRef` table field; the Rust and browser-safe validators accept a
non-empty asset-id string and reject other JSON kinds before publication.
TypeScript and provider projections preserve the wire type as `string`.

Regression evidence lives in:

- `packages/snapback-codegen/inline-result-contracts.test.mjs` — a
  photo-bearing table generates a precise `documents` contract for its live
  query;
- `src/result_contract.rs` and
  `packages/snapback-contract/result-contract-validator.test.mjs` — string
  acceptance and wrong-kind refusal;
- `demos/party-wall/tests/acceptance/headless.mjs` — seeded and uploaded typed
  photo references travel directly on the `eventWall` live rows.

Party Wall deleted `photoShares`, `wallPhotos`, and the duplicate `photoId`
display string. Its `posts.photo` field now owns attachment, membership-backed
sharing, seeding, reference GC, and live delivery. The assets and live-query
guide pages teach the direct pattern.
