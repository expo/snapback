# Project thumbhash placeholders with media reads so lists paint instantly

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Assets, Client,
React, Codegen

**Related:** LLP 0239 D5, LLP 0244; device-pass UX finding
(issues/shelved/20260815-finish-media-happy-path.md)

Admission already computes `placeholder: { algo: 'thumbhash.v1', value }`
and `dominantColor` into rendition mediaFacts, but v1 `MediaRef` projects
only `{ assetId, kind }` — so even a fast issuance round trip paints an
empty "issuing" tile first. Projecting the placeholder (coarse,
known-at-admission data — not the bytes) with media-bearing reads would let
`useSnapbackMedia`/`useSnapbackMediaCollection` render a blurred preview
synchronously and fade the real image in, eliminating perceived issuance
latency entirely for the private tiers.

Design surface: extend the mediaRef.v1 result contract (or a sibling
projection) with optional placeholder facts; wire MediaState to carry them
through `issuing`/`refreshing`; demo/guide update. Needs the usual exact
result-contract treatment (LLP 0244 discipline), so this is an LLP 0239/0244
amendment-sized change, not a patch.
