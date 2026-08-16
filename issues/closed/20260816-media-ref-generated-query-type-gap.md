# Generated query types expose the physical string for `v.media()`

**Status:** Resolved  
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

## Resolution

Resolved on 2026-08-16. Generated operation-result document types now render
the expanded result contract rather than indexing into `GeneratedDataModel`.
A `mediaRef.v1` leaf uses the client-owned public
`MediaRef<"image" | "video" | "audio" | "file">` type narrowed to the kinds
admitted by the field, while `GeneratedDataModel` continues to expose the
physical asset-reference string used by handler-side storage.

`packages/snapback-codegen/media-result-types.test.mjs` generates a LiveQuery
over an image media field and strictly typechecks that field when it is passed
directly to `useSnapbackMedia`. Its negative control proves that a physical
string cannot cross the same boundary as a `MediaRef`.
