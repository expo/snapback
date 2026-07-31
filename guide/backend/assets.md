---
title: Assets
id: backend.assets
order: 9
audience: agent-first
capabilities: [backend.assets]
authorities: [llp/0044-asset-storage-pipeline.rfc.md, src/assets.rs, src/local.rs, src/server.rs, packages/snapback-codegen/define.mjs, tests/acceptance/asset-lifecycle-v1-evidence.md]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-31
reviewed-commit: HEAD
---

# Assets

> **Local target only, files-first.** `asset_lifecycle_v1` ships on the
> local target with the filesystem store, TUS resumable transfer, and
> `private-strict` delivery. The image pipeline
> (`asset_image_pipeline_v1` — location stripping, renditions,
> placeholders) is design-only, so a `location: "strip"` image or video
> intent **refuses at generation** on every current target; only explicit
> `location: "retain"` media intents and non-media files upload today.
> Hosted targets report the whole capability Missing.

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

```js fragment reason="handler excerpt; the commit hook is exercised by the src/local.rs reference suite"
export const setAvatar = defineMutation({
  args: { profileId: v.id('profiles'), assetId: v.assetRef({ upload: 'avatarUpload' }) },
  handler: async (ctx, args) => {
    await ctx.db.patch('profiles', args.profileId, {
      avatar: await ctx.assets.attach(args.assetId, { upload: api.avatarUpload }),
    });
  },
});
```

Enforcement lives at the storage commit boundary, not the helper: a raw
id-shaped string written into a `v.assetRef` field fails the commit with
`SNAPBACK_ASSET_REF_UNVERIFIED` on every write path, and the reverse
reference edge commits in the same changeset. Deleting an asset refuses
while typed references remain.

## Deliver

`GET /assets/records/{id}` serves authorized metadata;
`GET /assets/records/{id}/bytes/{variant}` serves bytes (variant
`primary` in v1) under `private-strict`: every request re-authorizes
through the declared read-access policy, responses carry
`Cache-Control: private, no-store`, HTTP ranges work for media playback,
and active-content types are never served inline. Revoking access or
deleting the asset denies the next request.

## Operate

The CLI drives the same lifecycle for agents and fixtures (dev/test
targets, admin authority):

```sh
snapback assets put photo.pdf --upload avatarUpload --user user_a --url http://127.0.0.1:4287
snapback assets inspect <asset-id> --url http://127.0.0.1:4287
snapback assets list --state ready --url http://127.0.0.1:4287
snapback assets retry <asset-id> --url http://127.0.0.1:4287
snapback assets delete <asset-id> --user user_a --url http://127.0.0.1:4287
```

`put` uploads chunk-checksummed and finalizes end-to-end verified.
`inspect` prints the lifecycle — availability, receipts, quota, reference
edges, runner claims — and never byte samples, staging keys, or bearer
URLs. `retry` re-drives pending publication/ledger work under the
generation fence; it never reopens a terminal attempt.

Background maintenance (finalization re-drives, GC sweeps, publication
reconciliation) runs on the asset runner; set
`SNAPBACK_ASSET_RUNNER_DISABLED=1` to drive it deterministically in tests.

## Evidence and limits

The acceptance traceability map is
[`tests/acceptance/asset-lifecycle-v1-evidence.md`](../../tests/acceptance/asset-lifecycle-v1-evidence.md);
the manifest facts (stores, profiles, integrity grades, enforced limits,
and the explicit Missing nonclaims — backup/export, video finalization,
custom read authorizers, deferred length) live in
`schemas/capability.manifest.local-dev-sqlite-ibex.json` under `assets`.
Live no-polling readiness over the WebSocket channel and the client upload
task are the L1-14 follow-ups; until then poll `GET /assets/records/{id}`
or use `snapback assets inspect`.
