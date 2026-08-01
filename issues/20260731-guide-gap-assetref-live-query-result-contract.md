# Live queries cannot return v.assetRef fields (result-contract gap)

**Status:** OPEN — found building demos/party-wall (diary 0041 finding 1)

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
