---
title: Media happy paths
id: backend.media-happy-paths
order: 10
audience: agent-first
capabilities: [assets.media-field.v1]
authorities: [llp/0239-asset-collections-and-media-field.rfc.md, llp/0244-media-ref-projection.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-codegen/define.mjs, src/storage.rs, packages/snapback-client/assets.mjs, packages/snapback-react/implementation.mjs]
examples: [tests/acceptance/fixtures/media-profile/snapback/schema.mjs, tests/acceptance/fixtures/media-profile/snapback/functions.mjs, packages/snapback-codegen/media-field-authoring.test.mjs, packages/snapback-client/assets.test.mjs, packages/snapback-react/assets.test.mjs, packages/snapback-react/asset-upload-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
since: 0.1.21
unreleased: true
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:09b52a577407e1e6b1722c9f1d2bd3a8d13098307ff2a44f5c2f213624fd80c1
---

# Media happy paths

> **Unreleased.** The empty-safe media controller and React hook are newer
> than the newest published closure, 0.1.20. Use them from contributor source
> until a later closure publishes them.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is the four-path map from LLP 0239. Paths 1 and 3 are shipped in
contributor source. Paths 2 and 4 stay explicit GAPs so an agent does not
mistake the separately indexed collection and command RFC syntax for an
available API.

## Path 1 — store one optional profile image

Declare `v.optional(v.media(...))` at the top level of a table. Name the upload
intent, a policy-generation identity, and the closed coarse kinds the field
admits. This fixture is the complete optional-profile-image schema:

```js source=tests/acceptance/fixtures/media-profile/snapback/schema.mjs
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

// @ref LLP 0239#d1-vmedia-is-the-zero-or-one-application-field
// @ref LLP 0244#d3-vmedia-attachment-is-finalized-only-in-v1
export const profiles = defineTable({
  ownerId: v.principal(),
  displayName: v.string(),
  image: v.optional(v.media({
    intent: 'profileImageUpload',
    policy: 'profile-image.v1',
    kinds: ['image'],
    delivery: 'primary',
    variants: ['primary'],
  })),
})
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();

export default defineSchema({ profiles });
```

The named upload intent remains an ordinary asset upload declaration:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const profileImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png'], maxBytes: 8_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  image: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Await finalization before attaching its asset id. Writes carry the opaque id
string; a client-supplied `{ assetId, kind }` object is refused because `kind`
is output-only server authority. Query and LiveQuery results project a non-null
field as exact `{ assetId, kind }` inside the application row's pinned storage
snapshot. Optional null stays null. Media-bearing LiveQueries deliberately do
not receive the current single-table RQS resume class.

For a plain opaque reference with the older pending-attachment behavior, use
[`v.optional(v.assetRef(...))`](./assets.md#declare-the-upload-intent-and-the-reference-field).
It is a different contract and does not return `MediaRef`.

## Path 2 — attach a bounded media collection (GAP)

`assetCollection` is a later LLP 0239 rollout. Do not store asset references
inside `v.json()`, and do not infer that an ordinary app-owned array has asset
attachment, authorization, or GC semantics. Model explicit child rows using
the current [bounded relation guidance](./standard-patterns.md) when the
application cannot wait for the generated collection.

## Path 3 — render one authorized media reference or nothing

`useSnapbackMedia(mediaRefOrNull, options)` is empty-safe. `null` and
`undefined` synchronously return `{ status: "empty", media: null }`, start no
issuance, and make `refresh()` an inert resolved promise. An empty string is a
contract error that names the nullable spelling.

For non-empty input, pass only a `MediaRef` obtained from a server result. Its
coarse kind is disclosed with the readable media field even when separate
asset delivery is denied; projection success is not an asset-existence or
authorization oracle. The hook projects the shared issued-URL controller: image delivery
defaults to `primary`, accepts `widthPx` or an explicitly declared `variant`,
refreshes before expiry, and blanks the URL on denial or authority replacement.
It does not probe a signed route and does not claim portable video playback.

```ts source=packages/snapback-react/asset-upload-types.fixture.ts
export function ProfileMedia({ media }: { media: MediaRef<'image'> | null }) {
  const state = useSnapbackMedia(media, { widthPx: 640 });
  if (state.status === 'empty' || state.status === 'issuing') return null;
  if (state.status === 'ready' || state.status === 'refreshing') {
    return { src: state.url, alt: 'Profile' };
  }
  if (state.status === 'unavailable') {
    return { retry: () => state.refresh() };
  }
  return null;
}
```

`denied` is intentionally distinct from `unavailable`: denial carries a typed
authorization diagnostic and no URL. A transient unavailable state may be
retried. A valid URL remains visible while the controller is `refreshing`.

## Path 4 — upload and commit media in one command (GAP)

The LLP 0239 media command/binding is not part of this rollout. Keep using the
ordinary asset upload task and explicit mutation attachment described in
[Assets](./assets.md#upload-and-attach). Do not claim that cancellation rolls
back a mutation or that a response-loss retry has atomic media-command
semantics; those require the future closed binding.

## Anti-patterns

- Do not pass `""` for no media; pass `null` or `undefined`.
- Do not construct `{ assetId, kind }` from MIME guesses, filenames, or client
  upload assertions. `kind` is reserved for server-admitted result metadata.
- Do not write a projected `MediaRef` object back to a media field; attach its
  finalized `assetId` string through an authorized write.
- Do not probe signed routes to discover variants or playback support.
- Do not treat `assetCollection` or the media command as shipped.
- Do not claim `media.video.playable.v1`; this rollout adds no transcoding or
  portable container/codec guarantee.
