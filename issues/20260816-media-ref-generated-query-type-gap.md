# Generated query types expose the physical string for `v.media()`

**Status:** Open  
**Date:** 2026-08-16  
**Systems:** Codegen, Media, TypeScript clients  
**Related:** LLP 0244; `demos/media-happy-post/`

## Problem

`v.media()` correctly lowers to a physical asset-reference string and a
`mediaRef.v1` result-contract projection. At runtime the query result is the
public `{ assetId, kind }` shape required by LLP 0244. The generated TypeScript
reference still types a document result through `GeneratedDataModel`, whose
media field is the physical `string` column:

```ts
"profiles": { "ownerId": Principal; "displayName": string; "avatar"?: null | string };
```

Consequently this intended call does not typecheck directly:

```ts
useSnapbackMedia(profile.avatar)
```

The Media Happy Post demo uses a small validating boundary that accepts the
runtime projected value (and defensively upgrades a physical string) before
calling `useSnapbackMedia`. It does not cast the generated value.

## Expected resolution

Generate operation-result document types from the result contract so a
`mediaRef.v1` field is typed as the admitted media reference, while preserving
the physical string type for handler-side storage models. Add a strict fixture
that passes a generated LiveQuery media field directly to `useSnapbackMedia`.
