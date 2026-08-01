---
title: Assets
id: backend.assets
order: 9
audience: agent-first
capabilities: [backend.assets]
authorities: [llp/0044-asset-storage-pipeline.rfc.md, src/assets.rs, src/local.rs, src/server.rs, packages/snapback-codegen/define.mjs, tests/acceptance/asset-lifecycle-v1-evidence.md]
examples: [demos/party-wall]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-31
reviewed-commit: HEAD
---

# Assets

> **Local target only.** `asset_lifecycle_v1` and the image pipeline
> (`asset_image_pipeline_v1` — GPS stripping, declared renditions,
> ThumbHash placeholders, dominant color) both ship on the local target
> with the filesystem store, TUS resumable transfer, and
> `private-strict` delivery. A `location: "strip"` **image** intent
> admits and publishes here; a strip-declared **video** intent still
> refuses at generation everywhere (`asset-video-finalization` is a
> declared Missing nonclaim). Hosted targets report the whole capability
> Missing.

Use an asset when your app stores a file: bytes live outside document rows
under a Snapback-owned lifecycle — upload, trusted finalization, typed
attachment, authorized delivery, deletion — and your tables hold only a
typed reference.

## Declare the upload intent and the reference field

Upload authorization and policy are declared in source and compiled into a
generated reference. The intent fixes what a client can never widen:
accepted media types, byte bounds, delivery profile, and read-access
policy. The authorizer runs server-side and returns the owner.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['profiles'],
  accept: { mediaTypes: ['application/pdf', 'text/plain'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Reference assets from tables with `v.assetRef`. A restricted field
(`{ upload: 'avatarUpload' }`) admits only that intent's assets and is
writable from host plans; an unrestricted field is attachable only through
handler-side `ctx.assets.attach`. `assetSharing` declares who may read
assets referenced from a table's rows — without it, a reference confers no
read authority and the asset stays owner-only.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export default defineSchema({
  profiles: defineTable({
    ownerId: v.principal(),
    avatar: v.optional(v.assetRef({ upload: 'avatarUpload' })),
    attachment: v.assetRef(),
  })
    .assetSharing({ kind: 'owner', field: 'ownerId' })
    .sync(),
});
```

`assetSharing` takes the closed union `{ kind: 'public-read' }`,
`{ kind: 'owner', field }`, or `{ kind: 'membership', membership, roles? }`.
Declaring `access: { read: 'via-references' }` on an intent whose fields
can land in tables without the declaration emits
`SNAPBACK_ASSET_SHARING_UNDECLARED` at generation, listing the tables.

## Upload and attach

The client flow is: create an attempt (the generated reference plus the
declared byte length — deferred length refuses), transfer bytes over TUS
1.0.0 (`PATCH /assets/tus/{id}`, checksum every chunk), then finalize.
Finalization re-validates the admission witness, verifies length and
integrity, detects the content type from bytes, computes the SHA-256
canonical digest, dedups within the app, and publishes atomically. The
asset id is stable from creation — an expired attempt's authorized
successor keeps it.

Attach the asset to a row in an ordinary mutation:

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async createPhoto(ctx, args) {
    return await ctx.db.insert('photos', {
      ownerId: ctx.auth.userId,
      caption: String(args.caption ?? '').trim(),
      image: await ctx.assets.attach(args.assetId, { upload: 'photoUpload' }),
    });
  },
```

Enforcement lives at the storage commit boundary, not the helper: a raw
id-shaped string written into a `v.assetRef` field fails the commit with
`SNAPBACK_ASSET_REF_UNVERIFIED` on every write path, and the reverse
reference edge commits in the same changeset. Deleting an asset refuses
while typed references remain.

## Put typed photos directly in a live feed

`v.assetRef` is a first-class result-contract leaf. A query or live query may
return a table containing typed references directly; each reference is the
opaque asset-id string on the JSON wire. Do not duplicate it into a plain
string display column or split the reference into a side table merely to make
the row live-queryable.

Party Wall keeps the photo, membership-backed sharing policy, reverse-reference
edge, seed fixture, and live-feed row together:

```js source=demos/party-wall/snapback/schema.mjs
    posts: defineTable({
      eventId: v.id('events'),
      authorId: v.principal(),
      authorName: v.string(),
      caption: v.string(),
      photo: v.optional(v.assetRef({ upload: 'photoUpload' })),
    })
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
```

## Deliver

`GET /assets/records/{id}` serves authorized metadata;
`GET /assets/records/{id}/bytes/{variant}` serves bytes (variant
`primary` in v1) under `private-strict`: every request re-authorizes
through the declared read-access policy, responses carry
`Cache-Control: private, no-store`, HTTP ranges work for media playback,
and active-content types are never served inline. Revoking access or
deleting the asset denies the next request.

Intents may instead declare `delivery: { kind: 'public-immutable' }`
(ready renditions on `GET /assets/public/{id}/{variant}` with
year-long immutable cache headers — public product media) or
`{ kind: 'private-signed' }` (`POST /assets/records/{id}/signed-url`
issues a bearer URL under per-request authorization, valid until its
TTL). Both serve lanes are **pasteable**: the URL is the entire
authority, so a plain `<img src>`, a CDN pull, or a link pasted into an
email fetches with no Snapback headers — including on sessions-mode
servers, where every other asset route requires the auth-client
protocol offer. Signed issuance and strict delivery keep full
per-request authorization.

## Images

Declare a location policy on every image intent — omission refuses at
generation, and `strip` (the conventional choice) removes GPS metadata
from the canonical bytes before they are digested or stored, applying the
EXIF orientation and keeping only safe facts (dimensions, captured-at).
Declared variants render off the canonical bytes; mark one `required` and
it gates `ready`, produced atomically with the primary.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const photoUpload = defineAssetUpload({
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 1_000_000 },
  image: { location: 'strip', variants: [{ key: 'thumb', width: 128 }] },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

Every published image carries typed media facts on its primary rendition:
`width`/`height`, `placeholder: { algo: "thumbhash.v1", value }` (render
it client-side for instant previews), `dominantColor`, `locationPolicy`,
and `capturedAt` where the source declared one. Deliver a specific variant
by key, or let the server pick the best fit:

```text
GET /assets/records/{id}/bytes/thumb
GET /assets/records/{id}/bytes/best?maxWidth=480
```

Processing is bounded and adversarial-input safe: decoded pixels,
dimensions, decompression ratio, metadata size, step time, and output
bytes are all Enforced ceilings in the manifest's `assets.image` block,
and a hostile file (decompression bomb, dimension lie, truncated stream)
rejects the asset with a structured `SNAPBACK_ASSET_IMAGE_*` diagnostic.
Retain-declared intents (`location: 'retain'`) keep metadata intact and
record that policy in the asset's lifecycle evidence.

## Operate

The CLI drives the same lifecycle for agents and fixtures (dev/test
targets, admin authority):

```sh
snapback assets put photo.pdf --upload avatarUpload --user user_a --url http://127.0.0.1:4287
snapback assets inspect <asset-id> --url http://127.0.0.1:4287
snapback assets list --state ready --url http://127.0.0.1:4287
snapback assets retry <asset-id> --url http://127.0.0.1:4287
snapback assets gc-sweep --now-ms 1785484800000 --url http://127.0.0.1:4287
snapback assets delete <asset-id> --user user_a --url http://127.0.0.1:4287
```

`put` uploads chunk-checksummed and finalizes end-to-end verified.
`inspect` prints the lifecycle — availability, receipts, quota, reference
edges, runner claims — and never byte samples, staging keys, or bearer
URLs. `retry` re-drives pending publication/ledger work under the
generation fence; it never reopens a terminal attempt. `gc-sweep` requires
an explicit portable Unix-millisecond clock and runs the same attempt,
pending-asset, reference, tombstone, blob, retained-intent-artifact, and
publication cleanup as the background runner. Its report echoes `nowMs`;
each semantic reclamation keeps the ordinary asset lifecycle receipt.

Background maintenance (finalization re-drives, GC sweeps, publication
reconciliation) runs on the asset runner; set
`SNAPBACK_ASSET_RUNNER_DISABLED=1` to drive it deterministically in tests,
then invoke `asset.gcSweep` (or the CLI command above) with the suite's
chosen clock. Host operations do not keep a response replay ledger; the sweep
itself is idempotent, and each reclaimed asset receives its canonical
`reference-gc` lifecycle receipt exactly once.

## Evidence and limits

The acceptance traceability map is
[`tests/acceptance/asset-lifecycle-v1-evidence.md`](../../tests/acceptance/asset-lifecycle-v1-evidence.md);
the manifest facts (stores, profiles, integrity grades, enforced limits,
and the explicit Missing nonclaims — backup/export, video finalization,
custom read authorizers, deferred length) live in
`schemas/capability.manifest.local-dev-sqlite-ibex.json` under `assets`.
Live no-polling readiness ships as the reserved `_snapback.assetRecord`
projection (subscribe via the headless client's `watch`/`watchStore`), and
the framework-neutral upload task is `client.assets.start` in
`@expo/snapback-client`; the React/Expo hook and renderer are
`useSnapbackAssetUpload` / `useSnapbackAssetImage` in
`@expo/snapback-react`, and the real-server JS conformance vectors are
`tests/acceptance/asset-conformance-v1.mjs`.
