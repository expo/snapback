---
title: Media happy paths
id: backend.media-happy-paths
order: 10
audience: agent-first
capabilities: [assets.media-field.v1, assets.media-collection.v1, assets.media-command.v1]
authorities: [llp/0239-asset-collections-and-media-field.rfc.md, llp/0244-media-ref-projection.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/app-descriptor.mjs, src/storage.rs, packages/snapback-client/assets.mjs, packages/snapback-client/commands.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-react/implementation.mjs]
examples: [tests/acceptance/fixtures/media-profile/snapback/schema.mjs, tests/acceptance/fixtures/media-profile/snapback/functions.mjs, packages/snapback-codegen/media-field-authoring.test.mjs, packages/snapback-codegen/media-collection-authoring.test.mjs, packages/snapback-codegen/media-command-authoring.test.mjs, packages/snapback-client/assets.test.mjs, packages/snapback-client/commands.test.mjs, packages/snapback-react/assets.test.mjs, packages/snapback-react/commands.test.mjs, packages/snapback-react/asset-upload-types.fixture.ts, packages/snapback-react/media-collection-types.fixture.ts]
status: current
targets: [local]
maturity: shipped
since: 0.1.21
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:17c83fe601e56488b64e3952744f80e95cc17c899099ba8f0729ea401da5efac
---

# Media happy paths

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is the four-path map from LLP 0239. Paths 1 and 3 are in the current
published closure. Paths 2 and 4 are implemented and tested in contributor
source, with their publication boundary marked below.

## Path 1 — store one optional profile image

Declare `v.optional(v.media(...))` at the top level of a table. Name the upload
intent, a policy-generation identity, and the closed coarse kinds the field
admits. This fixture contains the complete optional-profile-image table:

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
  .visibility({ kind: 'public-read' })
  .assetSharing({ kind: 'owner', field: 'ownerId' })
  .sync();
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

<!-- since: 0.1.24 unreleased -->

> **Unreleased.** The collection client projection below is implemented in
> contributor source but is newer than the published 0.1.23 closure.

## Path 2 — attach a bounded media collection

Declare a finite collection before accepting files: `maxItems` is required and
must be 1–32, ordering is `manual` or `created`, and every admitted item must
already be finalized under the named intent with one of the declared coarse
kinds. The local target can upload and deliver original video bytes, but this
does not claim portable playback or `media.video.playable.v1`.

The framework generates the child relation and its list, append, replace,
remove, and reorder operations. Do not add an attachment table, JSON array, or
`image1`…`imageN` fields. This post declaration caps the relation at four and
the generated command binds one-to-four ordered uploads to its append:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
export const postMedia = assetCollection({
  ownerTable: 'posts',
  intent: 'sharedMediaUpload',
  maxItems: 4,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: 'none',
});

// @ref LLP 0264#d3-owner-inserts-are-host-stamped — the handler omits the
// installed owner field and closes its otherwise opaque generic-write ceiling.
export const createPostMutation = defineJsMutation({
  auth: 'authenticated',
  args: {
    body: v.string(),
    assetIds: v.array(v.assetRef({ upload: 'sharedMediaUpload' }), { maxItems: 4 }),
  },
  writes: ['posts'],
  opaqueWritePosture: 'conservative-v1',
  declaredTableCeiling: ['posts'],
  result: results.value(v.object({ _id: v.id('posts') })),
  handler: async (ctx, args) => ({
    _id: await ctx.db.insert('posts', { body: args.body }),
  }),
});

// @ref LLP 0239#d3-one-mediacommand-owns-multi-upload-plus-atomic-commit
export const createPost = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 4,
    kinds: ['image', 'video'],
  },
  mutation: createPostMutation,
  mapping: {
    passthrough: ['body'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'postMedia',
    operation: 'append',
  },
  sharing: assetSharing.none(),
});
```

Read the generated `postMediaList` LiveQuery and pass its ordered `children`
directly to the collection hook. The hook shares the issued-URL owner, keeps
each `itemId` stable, and isolates a denial or transient failure to one child:

```ts source=packages/snapback-react/media-collection-types.fixture.ts
export function MessageMedia({
  items,
}: {
  items: readonly MediaCollectionItem<'image' | 'video'>[];
}) {
  const projected = useSnapbackMediaCollection(items);
  return projected.map(({ itemId, state, refresh }) => {
    if (state.status === 'ready' || state.status === 'refreshing') {
      return { key: itemId, kind: state.media.kind, src: state.url };
    }
    if (state.status === 'unavailable') {
      return { key: itemId, retry: refresh };
    }
    return { key: itemId, hidden: true };
  });
}
```

An empty collection is synchronously `[]` and issues no request. `denied`
blanks only the affected URL; `unavailable` exposes its own retry; authorized
siblings remain visible. A ready video state is a delivered URL plus the
server-admitted coarse kind, not a promise that every browser can play it.

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

<!-- since: 0.1.24 unreleased -->

> **Unreleased.** The complete React/Expo command projection below is
> implemented in contributor source but is newer than the published 0.1.23
> closure.

## Path 4 — grant recipient access and revoke it

The command transfers and finalizes every byte source first. Only then does it
invoke the command-bound mutation once; the parent record, generated collection
rows, reference attachments, and selected grants share that one application
storage transaction. Uploaded bytes are outside that transaction. A commit
failure can therefore leave reported upload residue, cancellation after
invocation does not roll back a possible commit, and response loss remains an
explicit ambiguous settlement whose retry reuses the command attempt. This is
an online foreground task, not offline source-byte custody or background
upload, and this page makes no hosted-target claim.

Direct recipients are legal only because both the collection ceiling and the
command declare that closed plan. The host reauthorizes the caller and every
principal at commit time; a client-supplied principal is never authority by
assertion:

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const messageMedia = assetCollection({
  ownerTable: 'messages',
  intent: 'sharedMediaUpload',
  maxItems: 8,
  order: 'manual',
  kinds: ['image', 'video'],
  grants: {
    ceiling: {
      owner: { kind: 'owner-only' },
      recipients: { kind: 'recipients', state: 'active', maxRecipients: 8 },
    },
    default: 'owner',
  },
});
```

```js source=tests/acceptance/fixtures/media-profile/snapback/functions.mjs
export const sendMessage = defineMediaCommand({
  media: {
    input: 'media',
    intent: 'sharedMediaUpload',
    minItems: 1,
    maxItems: 8,
    kinds: ['image', 'video'],
  },
  mutation: sendMessageMutation,
  mapping: {
    passthrough: ['conversationId', 'text'],
    assetsToMutationArg: 'assetIds',
    parentResultPath: '_id',
    collection: 'messageMedia',
    operation: 'append',
    principals: { input: 'recipients', minItems: 1, maxItems: 8 },
  },
  sharing: assetSharing.recipients({ state: 'active', maxRecipients: 8 }),
});
```

Use the generated command reference—never its hidden target mutation. Removing
collection items through the generated operation detaches them and revokes the
collection-managed recipient grants in the same application transaction:

```ts source=packages/snapback-react/media-collection-types.fixture.ts
export function useMessageMediaActions() {
  const sendMessage = useSnapbackCommand(mediaProfileApp.commands.sendMessage);
  const removeMessageMedia = useSnapbackMutation(
    mediaProfileApp.api.mutations.messageMediaRemove,
    { queue: false },
  );
  return {
    send(
      conversationId: string,
      text: string,
      media: readonly AssetFileLike[],
      recipients: readonly Principal[],
    ) {
      return sendMessage({ conversationId, text, media, recipients });
    },
    revoke(parentId: Id<'messages'>, itemIds: readonly string[]) {
      return removeMessageMedia({ parentId, itemIds });
    },
  };
}
```

## Anti-patterns

- Do not pass `""` for no media; pass `null` or `undefined`.
- Do not construct `{ assetId, kind }` from MIME guesses, filenames, or client
  upload assertions. `kind` is reserved for server-admitted result metadata.
- Do not write a projected `MediaRef` object back to a media field; attach its
  finalized `assetId` string through an authorized write.
- Do not probe signed routes to discover variants or playback support.
- Do not hand-roll app-owned attachment tables, JSON media arrays, split media
  fields, or `image1`…`imageN`; declare an `assetCollection`.
- Do not call a media command's hidden mutation target or separately attach its
  uploaded asset ids; invoke `app.commands.<name>` through the command task.
- Do not claim `media.video.playable.v1`; this rollout adds no transcoding or
  portable container/codec guarantee.
