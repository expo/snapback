---
title: Assets
id: backend.assets
order: 9
audience: agent-first
capabilities: [backend.assets, clients.asset-signed-delivery, clients.asset-upload]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0044-asset-storage-pipeline.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0180-asset-bearing-client-commands.rfc.md, llp/0181-zero-configuration-expo.rfc.md, llp/0210-asset-upload-dx-closure.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, crates/snapback-services/src/assets.rs, crates/snapback-services/src/assets_cut.rs, crates/snapback/src/cli.rs, crates/snapback-engine/src/local.rs, crates/snapback/src/server.rs, crates/snapback/src/server/asset_routes.rs, packages/snapback-client/assets.mjs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/familiar.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-react/index.mjs, packages/snapback-react/index.d.mts, packages/snapback-vite/allowlist.mjs, tests/acceptance/asset-lifecycle-v1-evidence.md, demos/zerobugs/control/snapback/functions.mjs, demos/zerobugs/control/composition/server.mts]
examples: [demos/party-wall, demos/file-drop, demos/tandem-expo-bakeoff, demos/expo-golden-path-fixture, demos/zerobugs/control, tests/acceptance/fixtures/familiar-video-asset, tests/acceptance/familiar-video-asset-v1.mjs, packages/snapback-client/assets.test.mjs, packages/snapback-react/assets.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ac2cd7a89de0a56f4add93da19c9e943c1fd38470c9d223c21fa404259320788
---

# Assets

> **Local target only.** `asset_lifecycle_v1`, the image pipeline
> (`asset_image_pipeline_v1` — GPS stripping, declared renditions,
> ThumbHash placeholders, dominant color), and video location
> finalization (`asset_video_finalization_v1` — MP4/QuickTime location
> atoms blanked in place, no transcoding) all ship on the local target
> with the filesystem store, TUS resumable transfer, and all three delivery
> profiles. Location-bearing media require an explicit
> media-specific location declaration either way: images use
> `image: { location }`, while videos use the distinct sibling
> `video: { location }`. A `"strip"` image or video intent admits and
> publishes here with location metadata provably absent from served
> bytes; `"retain"` preserves the source bytes identically and records
> the choice in lifecycle evidence. Hosted targets report the whole
> capability Missing.

Use an asset when your app stores a file: bytes live outside document rows
under a Snapback-owned lifecycle — upload, trusted finalization, typed
attachment, authorized delivery, deletion — and your tables hold only a
typed reference.

## Choose public performance or revocable reads

Choose delivery before the first upload. For an explicit
`defineAssetUpload`, omitting `delivery` uses `public-immutable` and emits a
source-attributed advisory asking you to declare the decision explicitly:

- **`public-immutable` is the performance default.** Immutable bytes live at
  unguessable, CDN-shaped URLs with no issuance round trip. Use it for public
  feed media, avatars, product images, and other bytes that never need access
  revoked. Delete stops discovery and future canonical access; it cannot
  retract an already cached public response.
- **`private-signed` authorizes per-user URL issuance.** Use it when reads must
  be authorized but a native renderer such as `<Image>` cannot attach bearer
  headers. Revocation stops new issuance; an issued URL remains usable until
  its TTL.
- **`private-strict` is bearer-only and issues no signed URLs.** Every byte
  request reauthorizes, so this is the tier for next-request revocation when
  the client can send the bearer header.

The bare `v.assetRef()` derived intent below is a separate convenience and
intentionally remains private-strict. For explicit intents, do not rely on the
omission advisory as policy review: spell the chosen tier in source.

## The minimal path: one field, one attach line

The simplest case needs no upload intent at all. A bare `v.assetRef()`
field derives a generated **default intent** — strict delivery, GPS
stripped, owner-only reads, JPEG/PNG up to 10 MB — with a stable identity
in the manifest like any explicit intent (LLP 0044 §Ceremony floor):

```js fragment reason="minimal-path schema shape; the authoring suite verifies derivation"
// schema.mjs — the whole backend declaration for an avatar:
profiles: defineTable({
  ownerId: v.principal(),
  avatar: v.optional(v.assetRef()),
}).sync(),
```

Upload under the derived reference (`defaults.<table>.<field>` in the
generated api), then attach in any ordinary mutation:

```js fragment reason="client flow over the derived reference; conformance covers the transport"
import { defaults } from './snapback/generated/api.mjs';
const task = client.assets.start({ upload: defaults.profiles.avatar, file });
// in a mutation handler:
//   { avatar: await ctx.assets.attach(args.assetId) }
```

Sized thumbnails need no declared variants either — request any width and
the ladder rendition materializes once, then serves immutably:

```js fragment reason="width selector URL shape; the Rust e2e verifies materialization"
assets.deliveryUrl(assetId, { variant: 'primary', width: 128 });
// → /assets/records/<id>/bytes/primary?width=128 (ladder-normalized)
```

That is the whole ceremony: **one schema field plus one attach line.**
Declare an explicit intent (below) when you need different bounds, media
types, sharing, variants, callbacks, or delivery profiles — the derived
default is the paved floor, not the ceiling. The prior unrestricted
bare-field semantics keep the explicit spelling
`v.assetRef({ upload: null })`.

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
  accept: { mediaTypes: ['application/pdf', 'application/octet-stream'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

In the Familiar TypeScript profile, import the same constructor from
`./generated/server` and export it from a top-level module. For example,
`media.ts` exporting `videoUpload` becomes canonical intent
`media.videoUpload` and generated reference `api.media.videoUpload`:

```ts source=tests/acceptance/fixtures/familiar-video-asset/media.ts
import { defineAssetUpload } from './generated/server';

export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

That is only a naming projection. It uses this same intent policy, asset
client, finalizer, typed reference, and delivery path; it does not derive video
through the image-only bare-field default.

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
    .visibility({ kind: 'owner', field: 'ownerId' })
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

**A dev/test server with no real client session can never complete a
multi-step upload over the ordinary client HTTP surface — for any intent auth
mode.** Every upload attempt records the non-optional owner principal returned
by `authorize`. Transfer, finalization, and attachment compare that owner with
the caller resolved from each request. An anonymous browser, React Native, or
Expo request has no caller principal, so the server refuses attempt creation
before running the authorizer or reserving state with
`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`. Setting `auth: 'public'` does
not make ownership checks anonymous — a public intent remains legitimate with
session custody — and `public-immutable` controls delivery rather than upload
authority. Passing a `userId` option to the task is not authentication.

There are exactly two paved local-development answers:

1. For an operator, fixture, or headless proof, use the admin-impersonated CLI
   lane: `snapback assets put ... --user <handle>`. This is not an in-app
   upload path.
2. For an interactive browser or native app, run the app in settled Sessions
   auth mode and give it an ordinary session. A trusted local process that
   already holds the ready-file/operator authority can mint one through the
   shipped wrapper:

```sh
snapback session mint --email expo-dev@example.com --ready-file .snapback/dev.ready.json
```

The command prints a `hostOpsResult` whose `data.token` is the ordinary
session bearer; it never prints the impersonation capability. In an app, keep
the command or equivalent `auth.mintSession` host operation behind a trusted
development broker that authenticates its caller and returns only that
caller's session. Never put the ready file, admin token, impersonation
capability, mailbox reader, or a generic mint-for-email endpoint in an Expo
bundle. Adopt the returned bearer with `createExternalSessionClient` before
preparing the React provider, as described in
[native auth](../auth/native-apps.md):

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
      activeServerOrigin = brokerPayload.serverOrigin;
      const client = createExternalSessionClient(brokerPayload.serverOrigin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
      return { status: 'ready' as const, client, provider: createSnapbackReactProvider(binding) };
```

That broker response carries the stack-selected public backend origin beside
the bearer. A dynamic development port must come from the target's ready
descriptor or this kind of stack-owned carrier, never an app-owned fixed
fallback.

Separately, for a deterministic fixture that composes password accounts,
application-owned profiles, and typed avatars without admin impersonation,
follow the [sessions fixture installer](../recipes/sessions-fixture-install.md).
It reports `{ ok, accounts, profiles }`; its matched-repeat branch signs in and
verifies the fixture source digest, then skips asset uploads and
application-data writes.

The client flow is: create an attempt (the generated reference plus the
declared byte length — deferred length refuses), transfer bytes over TUS
1.0.0 (`PATCH /assets/tus/{id}`, checksum every chunk), then finalize.
Finalization re-validates the admission witness, verifies length and
integrity, detects the content type from bytes, computes the SHA-256
canonical digest, dedups within the app, and publishes atomically. The
asset id is stable from creation — an expired attempt's authorized
successor keeps it.

Dedup is by canonical bytes, by design: uploading byte-identical files
twice in one app yields two assets sharing one stored blob (each still
consumes logical quota). Two consequences worth knowing when you batch:
a burst of *identical* test images collapses to one set of stored bytes
— make fixtures byte-distinct (a unique comment segment suffices) when
your test needs distinct blobs; and attachment does not wait for
publication — `ctx.assets.attach` admits a `pending` asset (the
optimistic path), so you can attach in the same flow that started the
upload and let live readiness catch up.

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

## Send one Expo ImagePicker image with an ordinary session

For a declared asset-bearing command, `SnapbackExpoProvider` registers the
native source adapter and binary transport once. Pass the real
`expo-image-picker` asset directly to the generated command; application code
does not call `expo/fetch`, start a raw upload, or carry an asset id between
steps:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (result.canceled || !result.assets[0]) {
      emitG3('picker-cancelled');
      return;
    }
    const picked = result.assets[0];
    emitG3('picker-image-selected', {
      source: 'photo-library-picker',
      uriScheme: picked.uri.slice(0, picked.uri.indexOf(':')).toLowerCase(),
      fileName: picked.fileName ?? null,
      mimeType: picked.mimeType ?? null,
      fileSize: picked.fileSize ?? null,
    });
    try {
      const body = proofEnabled ? G3_IMAGE_BODY : draft.trim() || undefined;
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

The adapter accepts picker-owned `content://`, `ph://`, and `file://` records.
It copies the live-process bytes into an immutable, slice-readable structural
source for the existing asset task. Expo's WinterCG fetch carries binary
checksum/TUS requests. On Expo 57 Android only, a picker-cache `file://` that
returns a genuine 404 through `expo/fetch` falls back to local
`expo-file-system` `File.bytes()`; the 404 text is never treated as image
bytes.

The command still uses the provider's already adopted ordinary session for
asset reservation, transfer, and mutation. Its task exposes `preparing`,
`transferring`, `committing`, and the truthful terminal outcomes described in
[application surfaces](../clients/surfaces.md). Render those phases and await
`task.done`; `committed` proves the ordinary mutation settled, while `failed`,
`ambiguous`, and `cancelled` must remain distinct. A post-finalize mutation
failure can retain residue and is not a rollback receipt.

This adapter is transient live-process custody. It does not prove background
upload, restart recovery, offline source custody or settlement, or attempt
grants. Use the raw `useSnapbackAssetUpload`/`assets.start` seam for workflows
that do not fit the one-optional-asset command grammar.

> **Coming from Convex/Supabase?** See
> [Upload and attach an Expo image under session custody](../recipes/coming-from-convex-and-supabase.md#expo-media-upload)
> for the worked translation of Supabase Storage or Convex
> `generateUploadUrl` — including why ownership is never anonymous even when
> attempt creation is public, and why GPS/EXIF stripping happens server-side
> at trusted finalization rather than client-side.

## Render the uploaded image in a plain `<Image>`

`useSnapbackAssetImage` (from `@expo/snapback-react`) is the renderer
ladder — local preview → ThumbHash placeholder → delivered rendition — and
its `src` goes straight into a plain `<img>` or React Native `<Image>`. Do
not build delivery URLs by hand and do not read package source to pick a
route:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
function NativeAssetImage({ assetId, userId, onRendered }: Readonly<{
  assetId: string;
  userId: Id<'users'>;
  onRendered(src: string): void;
}>) {
  // The shared convenience component is intentionally DOM-only. Expo uses
  // the same canonical delivery ladder through its hook, then hands the URL
  // to React Native's image loader.
  const image = useSnapbackAssetImage({ assetId, maxWidth: 760, userId });
  if (!image.src) return <ActivityIndicator color={palette.accent} style={styles.imageLoader} />;
  return (
    <Image
      accessibilityLabel="Shared photo"
      onLoad={() => { if (image.phase === 'rendition' && image.src) onRendered(image.src); }}
      resizeMode="cover"
      source={{ uri: image.src }}
      style={[styles.image, image.aspectRatio ? { aspectRatio: image.aspectRatio } : null]}
      testID={`asset-image-${assetId}`}
    />
  );
```

<!-- since: 0.1.12 -->

Three facts make this the whole recipe — there is no workaround to learn:

- **`src` is the most-permissive delivery URL the asset's declared policy
  actually grants.** An intent with `delivery: { kind: 'public-immutable' }`
  gets the pasteable public rendition URL (`/assets/public/{id}/{variant}`);
  the strict route becomes `src` only when nothing more permissive exists.
  This is URL selection, not authorization — the server still decides every
  request under Deliver's rules below.
- **The rendition-publication race is held for you.** Optional renditions
  publish asynchronously after `ready`. While a public-immutable asset has
  no ready rendition yet, `delivery` reports `'pending'` and the hook keeps
  the preview/placeholder underlay instead of emitting a URL that would 404
  or render an empty image. The live record projection flips the hook to the
  rendition on its own — no `onError` retry loop.
- **`strictSrc` always carries the header-authorized strict route**, for
  consumers that fetch bytes with the authenticated client. On a
  sessions-mode server a plain `<img>`/`<Image>` cannot send the required
  `x-snapback-auth-client-protocol` header (see Deliver below), so when only
  strict delivery exists there the hook warns once per asset with
  `SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS` instead of leaving empty
  image bubbles undiagnosed. Declare public-immutable delivery on the
  upload intent when the image must render in a plain image tag.

## Run lifecycle callbacks

An explicit upload intent may name an ordinary mutation for `ready` and/or
`rejected`. The mutation must declare exactly `{ event: v.string(), assetId:
v.string(), facts: v.json() }`; the facts are safe lifecycle metadata, never
byte authority, staging keys, or delivery bearers.

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const fileUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream', 'application/zip'], maxBytes: 100_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  on: { ready: 'recordAssetReady' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

```js source=tests/acceptance/fixtures/asset-conformance/functions.mjs
export const recordAssetReady = defineJsMutation({
  auth: 'authenticated',
  args: { event: v.string(), assetId: v.string(), facts: v.json() },
  source: 'handlers.mjs',
  exportName: 'recordAssetReady',
  writes: ['assetCallbackLog'],
});
```

The runner uses the stable mutation identity
`asset-cb:<asset>:<event>:<generation>`, so retrying the same work cannot
double the committed effect. A callback failure retries independently and
never degrades an already-ready asset.

Authority differs honestly by auth mode. Dev callbacks preserve the existing
asset-owner dev authority. Sessions callbacks run under one per-app, narrowly
granted service principal named `asset-callbacks`; Snapback never mints an
owner session or bearer. In sessions callbacks `ctx.auth.sessionId` is `null`,
`ctx.auth.kind` is `"agent"`, and `ctx.auth.actorKind` is
`"asset-callbacks"`, so application code and stored audit rows can distinguish
the scheduled actor from an interactive user. The callback still follows the
ordinary staged mutation, commit-time grant validation, authorization-event,
and receipt path. The asset work-completion receipt records the service actor
and exact grant, without carrying any bearer.

```js source=tests/acceptance/fixtures/asset-conformance/handlers.mjs
  async recordAssetReady(ctx, args) {
    return await ctx.db.insert('assetCallbackLog', {
      assetId: args.assetId,
      event: args.event,
      actorId: ctx.auth.userId,
      actorKind: ctx.auth.actorKind,
      provider: ctx.auth.provider,
      sessionId: ctx.auth.sessionId,
    });
  },
```

## Attach several assets to one row (multi-image posts)

There is no `v.array(v.assetRef(...))` — the withdrawal is a standing
author ruling (LLP 0044, 2026-07-31; scope reaffirmed 2026-08-09), and
the answer is **not** a column splay (`img1`…`img4` with four identical
declarations and four attach calls — the shape the Clique pilot fell
into). Multi-asset relationships take the bounded-children path: an
ordered child table whose rows each carry one `v.assetRef`, a typed
reference to the parent row, and a position field. The parent stays
cheap to read on its own; the children arrive through an ordinary
child-row query (or a relational query when the join fits); each child
attaches independently in the same mutation; and per-asset deletion is
a row delete instead of a column shuffle. Party Wall (below) is the
CI-validated composition — its `posts` table is exactly this shape with
a bound of one, and the same pattern extends to a declared 1–4 bound
with a `position` column and a uniqueness index on
`(parentId, position)`.

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
      .visibility({
        kind: 'membership',
        declaration: eventMembers,
        resourceField: 'eventId',
        roles: ['host', 'guest'],
      })
      .index('by_event', ['eventId'])
      .assetSharing({ kind: 'membership', membership: 'eventMembers' })
      .sync(),
```

## Browser apps: the paved React + Vite path

A browser app reaches every asset route through the first-party dev relay:
`@expo/snapback-vite` forwards the complete author-facing `/assets/*`
family — attempts, TUS transfer, records, strict/signed/public delivery —
under `/__snapback`, while continuing to refuse `/_snapback/*` system and
admin routes (`packages/snapback-vite/allowlist.mjs`). No app-owned Vite
proxy is needed, and a relative URL such as
`/__snapback/assets/public/<id>/display` works directly as an `<img src>`.

The relay is a Vite-loop convenience, not a CORS requirement. The dev
server's CORS lane admits loopback browser origins directly, and its
preflight allows the TUS request headers (`tus-resumable`,
`upload-offset`, `upload-length`, `upload-checksum`) and exposes the TUS
response family (including `upload-offset`) to page JavaScript. A browser
carrier with no Vite relay — Expo web is the common case — completes
picker → `useSnapbackAssetUpload` → typed attach against the dev server
origin with no app-authored proxy. Relative delivery URLs are the one
relay-only affordance; a direct cross-origin app uses absolute delivery
URLs against the dev server origin instead.

Two facts shape the browser flow:

- **Interactive uploads need sessions custody.** The ordinary browser and
  native HTTP carriers resolve as anonymous when no real session is present,
  so the reservation refusal described under Upload and attach applies to
  every intent auth mode. The `--user` lane under Operate below is the
  CLI/host-op path (admin authority for agents and fixtures), not a browser or
  Expo path.
- **The sign-in code arrives through a trusted-local seam.** The dev
  mailbox is admin- and impersonation-gated
  ([sessions guide](../auth/sessions-and-principals.md)), so a browser demo
  reads it through a small server-side dev middleware that holds both
  carriers and hands the page only the one-time code — neither credential
  enters the bundle, and the relay never forwards the mailbox route.

Explicit and derived upload references are typed members of the generated
api (`AssetUploadReference` in `api.d.ts`; derived defaults are typed per
table and field on `defaults`), so the generated reference is accepted
directly — no cast:

```tsx fragment reason="hook call shape; the demo app strict-typechecks it in the proof"
const upload = useSnapbackAssetUpload({ upload: api.photoUpload });
```

```js source=demos/file-drop/tests/acceptance/browser-relay.mjs
    const task = assets.start({
      upload: api.photoUpload,
      file,
      declaredFilename: 'snapback-balloons.png',
      declaredContentType: 'image/png',
    });
```

The complete path — relay health, the system-route refusal, mailbox
sessions sign-in, typed upload to `ready`, typed attachment, the live
gallery update over the relayed WebSocket, and public rendition delivery
through the relay — is CI-verified by
`demos/file-drop/tests/acceptance/browser-relay.mjs` (run from
`scripts/verify-local-proof`); Snapdrop
([`demos/file-drop`](repo:demos/file-drop/README.md)) is the runnable demo.

## Deliver

`GET /assets/records/{id}` serves authorized metadata. The recommended
performance tier, `delivery: { kind: 'public-immutable' }`, serves ready
renditions on `GET /assets/public/{id}/{variant}` with year-long immutable
cache headers and no issuance request. Omission on `defineAssetUpload` selects
that tier, with an advisory; explicit declaration is still the documented
spelling.

Choose `{ kind: 'private-signed' }` when issuance must authorize each user but
the renderer cannot send a bearer. `POST /assets/records/{id}/signed-url`
issues a bearer URL valid until its TTL. Public and signed serve lanes are
**pasteable**: the URL is the entire
authority, so a plain `<img src>`, a CDN pull, or a link pasted into an
email fetches with no Snapback headers — including on sessions-mode
servers, where every other asset route requires the auth-client
protocol offer. Signed issuance and strict delivery keep full
per-request authorization.

Choose `private-strict` for immediate revocation. The
`GET /assets/records/{id}/bytes/{variant}` route (variant `primary` in v1)
reauthorizes every request through the declared read-access policy, carries
`Cache-Control: private, no-store`, supports HTTP ranges, and never serves
active-content types inline. Revoking access or deleting the asset denies the
next request. Two sizing selectors ride the byte routes:
`best?maxWidth=N` picks the largest *declared* variant within the bound, and
`?width=N` ladder-normalizes to a bounded on-demand rendition (materialized
once under the image ceilings, then immutable; refused above the declared
2048 ceiling or without the image-finalization fact). Signed issuance accepts
`widthPx` the same way and signs the concrete ladder variant.

On a sessions-mode server, a plain signed-out request to a
`private-strict` byte URL that omits the auth-client protocol offer is
malformed before the server can decide whether it is unauthorized. It
therefore returns HTTP 400 with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, not 401 or 403; send
`x-snapback-auth-client-protocol: 1` (and the session bearer when signed in)
on strict delivery requests. Public-immutable and already-issued signed byte
URLs are the pasteable exception: plain HTTP clients need no protocol offer
and receive their ordinary 200/403/404 delivery semantics. This ordering is
the reviewed status posture in [LLP 0012](repo:llp/0012-headless-integration-contract.spec.md)
and the per-profile offer contract in
[LLP 0096](repo:llp/0096-auth-profiles-for-protocol-clients.spec.md).

<!-- since: 0.1.16 -->

### Issue and refresh a private signed URL

The signed-URL request body is the closed object `{ variant?, widthPx?,
ttlMs? }`. Omitting `variant` selects `primary`; an entirely absent or empty
body and `{}` are valid default requests. `widthPx` selects a bounded ladder
rendition and supersedes `variant`. `ttlMs` must be between 1 and the target's
declared `assets.signedUrlMaxTtlMs` (86,400,000 ms on the local target); when
omitted, the target's declared default applies (900,000 ms locally).

Request parsing never escapes as a framework 422. Malformed JSON, unknown
members, or a wrongly typed field refuse with
`SNAPBACK_ASSET_REQUEST_INVALID`, whose details name the field. An authorized
request for an undeclared variant refuses with
`SNAPBACK_ASSET_VARIANT_UNKNOWN`; `details.variants` enumerates `primary` plus
the intent's declared keys. Authorization runs before that enumeration. An
unauthorized caller gets the same ordinary `SNAPBACK_ASSET_FORBIDDEN` denial
for an existing or nonexistent asset, with no variant list or existence
oracle.

Use the framework-neutral asset client instead of posting to the route. Each
`assets.signedUrl(assetId, options)` call performs one pure issuance, adds the
current client-owned custody headers and auth-client protocol offer, resolves a relative
server response against the client's base URL, and returns
`{ url, expiresAt, variant }`. It deliberately does not cache.

For a non-React renderer, call `assets.issuedUrlStore(assetId, options)` and
subscribe to its external-store contract. Equal asset/option/authority keys
share one issuance loop. Render its five states this way:

| State | URL | Rendering meaning |
| --- | --- | --- |
| `issuing` | `null` | Initial or post-expiry issuance is in flight; render a loading placeholder. |
| `ready` | valid | Render the URL. A transient refresh failure may leave this state and attach a diagnostic while the held URL is still valid. |
| `refreshing` | valid | Keep rendering the held URL while replacement issuance is in flight. |
| `unavailable` | `null` | No valid URL is held after a transport or server failure; render the offline/error fallback while bounded retry continues. |
| `denied` | `null` | A structured authorization refusal blanked the URL and stopped timer retry; render the access-denied state. |

`store.refresh()` is the explicit exit from `denied` after the application
expects authority to have returned. Logout or authority replacement disposes
the old entry synchronously, and a final unsubscribe fences in-flight work.

React and Expo use `useSnapbackAssetUrl`, which projects that same controller;
it does not add another cache or timer. The hook returns the five-state
snapshot plus a stable `refresh()`:

```ts source=packages/snapback-react/asset-upload-types.fixture.ts
const issuedUrl: AssetUrlState = useSnapbackAssetUrl('asset-1', {
  variant: 'chat',
  widthPx: 640,
  ttlMs: 30_000,
});
issuedUrl.url?.toUpperCase();
const issuedDiagnostic: AssetDiagnostic | null = issuedUrl.diagnostic;
const refreshed: Promise<void> = issuedUrl.refresh();
void issuedDiagnostic;
void refreshed;
```

TTL refresh is platform-owned. Applications should not hand-roll issuance
fetches, custody headers, URL caches, expiry timers, or one cache per
component; those were pilot workarounds and are now replaced by
`signedUrl`, `issuedUrlStore`, and `useSnapbackAssetUrl`.

### Upload when you only need the ready asset id

Use `assets.upload(uploadRef, source, { args? })` when the caller needs only a
ready asset id. It accepts the same normalized inputs as the platform
adapters: `File`, `Blob`, or picker-shaped
`{ uri, mimeType?, fileName? }`. It never retries and exposes no progress;
use `assets.start()` when the UI needs pause, resume, cancel, retry, preview,
or progress.

The raw task contract is frozen: `task.done` resolves at the first terminal
status — `ready | rejected | cancelled | failed`. `ready` is the only success.
`assets.upload()` therefore resolves with `assetId` only for `ready` and
rejects every other row with an error carrying `terminalStatus` and the
structured `diagnostic`. The package fixture pins both branches:

```js source=packages/snapback-client/assets.test.mjs
    if (status === 'ready') {
      assert.equal(
        await assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        'asset_upload_helper',
      );
    } else {
      await assert.rejects(
        assets.upload(AVATAR_UPLOAD_REF, new Blob(['x'])),
        (error) => error instanceof Error
          && error.status === status
          && error.terminalStatus === status
          && error.diagnostic.code === 'SNAPBACK_ASSET_TEST_TRANSIENT'
          && error.diagnostic.details.row === status,
      );
    }
```

The settled task snapshot and its `done` value never mutate. An eligible
`retry()` returns a successor task for the same asset id with an independent
generation; the predecessor stays frozen. `failed` and `cancelled` are
eligible only while the underlying asset remains pending, while `ready` and
`rejected` are never eligible. Any ineligible retry creates no successor and
refuses with `SNAPBACK_ASSET_RETRY_INELIGIBLE`.

### Grant and revoke per-recipient access

The paved view-once recipe uses first-class asset grants. Opt the upload intent
in explicitly, keep its ordinary policy owner-only so the grant is the
recipient's sole authority path, and choose a revocable delivery profile:

For the complete send → open → close/delete → delivery composition, use the
[view-once media recipe](../recipes/view-once-media.md). This section is the
operation reference; the recipe carries the application-owned consumption and
live-edge bookkeeping that make "view once" a product behavior.

```js fragment reason="view-once intent showing the grants opt-in and sole-authority constraint"
export const messageImageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg'], maxBytes: 10_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  grants: true,
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

At send time the asset owner mints one pending grant per recipient in the same
mutation as the message write. Pending grants confer no read access:

```js fragment reason="application-specific message writes surround this grant operation"
const { grantId } = await ctx.assets.grant(assetId, recipientPrincipal, {
  state: 'pending',
});
```

The named recipient activates that grant in its authorized `open()` mutation,
and either the recipient or asset owner removes it on close or deletion:

```js fragment reason="application-specific open/consumption checks surround these transitions"
await ctx.assets.activate(grantId);
await ctx.assets.revoke(grantId);
```

All three transitions commit atomically with the mutation's app-row writes.
Only the asset owner can mint; only the named principal can activate a pending
grant; the owner or named principal can revoke. Revoke removes the record, so a
later operation on that `grantId` refuses as unknown. Re-running the same
mutation `clientKey` replays its original result instead of minting a second
edge. `grants: true` is captured when the asset is admitted: adding it in a
later deploy does not make older assets grantable.

Two retention and delivery constraints are load-bearing:

- A grant must be the recipient's **sole authority path**. Public delivery or
  a recipient-visible `via-references` edge bypasses pending and revoke.
- An active grant protects the asset from reference GC; a pending grant does
  not. Keep a typed reverse reference, such as the message row's `assetRef`,
  alive for the entire pending window.

With `private-signed`, revoke stops new issuance but an already-issued bearer
URL remains usable until its TTL. With `private-strict`, revoke denies the next
governed request. Neither profile retracts bytes already copied, so view-once
media must not enter a durable application cache.

Each app may hold at most 1,024 pending plus active asset grants. The ceiling is
checked atomically when the owner mints; revoke releases capacity atomically.

#### Portable fallback: app-owned grant rows

When an application needs filterable grant metadata or must remain portable to
a target without first-class grant operations, compose ordinary app rows with
`via-references` authorization. Put the typed reference in a dedicated row
whose owner-principal sharing field is the current viewer:

```js fragment reason="pilot-proven row composition; no in-repo fixture contains the complete app-specific authorization checks"
mediaGrants: defineTable({
  messageId: v.id('messages'),
  targetPrincipal: v.principal(),
  viewerPrincipal: v.principal(),
  asset: v.assetRef({ upload: 'messageImageUpload' }),
  state: v.string(), // 'pending' | 'active'
})
  .index('by_message_target', ['messageId', 'targetPrincipal'], { unique: true })
  .assetSharing({ kind: 'owner', field: 'viewerPrincipal' })
  .sync(),
```

At send time, the sender calls `ctx.assets.attach` and inserts one grant row
per recipient. Set `targetPrincipal` to the recipient, but set
`viewerPrincipal` to the sender and `state` to `pending`; the sender must
pre-mint because `ctx.assets.attach` admits the asset owner, not the future
viewer. The row's typed `asset` field is also the reverse reference that keeps
the asset protected through this pending window.

In the recipient's authorized `open()` mutation, verify the message and
recipient, reject an already-consumed view in an app-owned consumption row,
then patch that recipient's grant row atomically:

```js fragment reason="application-specific authorization and consumption checks surround this core transfer-at-open operation"
await ctx.db.patch('mediaGrants', grant._id, {
  viewerPrincipal: ctx.auth.userId,
  state: 'active',
});
```

The viewer can now issue or fetch under the intent's delivery profile. On
`close()`, delete that recipient's grant row; delete-for-everyone deletes all
rows for the message. Remove any remaining typed references before deleting
the asset itself. Never recreate a consumed row: the separate consumption
record is what makes a second `open()` refuse rather than minting authority
again.

Two constraints are load-bearing:

- The grant row must be the recipient's **sole authority path**. A public
  profile, another recipient-visible `assetSharing` table, or another
  `via-references` edge would bypass the pending/close transition. A message
  row may retain a typed asset reference for storage integrity, but that table
  must not declare asset sharing that admits the recipient.
- A typed reverse reference must remain alive for the entire pending window.
  The pre-minted grant row supplies one above; do not replace it with a plain
  asset-id string, or reference GC can reclaim the asset before `open()`.

The same signed-versus-strict delivery limits apply to this fallback. Prefer
first-class grant operations unless the extra app-row shape is itself part of
the product model.

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
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
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

## Video

Video location policy is a sibling declaration, not an alias through the
image block. Use `video.location` for accepted video types; an intent that
accepts both location-bearing images and videos declares both blocks. On the
local target, `strip` blanks MP4/QuickTime location atoms in place without
transcoding, while `retain` publishes the received bytes unchanged.

```js source=packages/snapback-codegen/asset-upload-authoring.test.mjs
export const clipUpload = defineAssetUpload({
  accept: { mediaTypes: ['video/mp4'], maxBytes: 100_000_000 },
  // Public display media follows the 2026-08-16 performance-default ruling.
  delivery: { kind: 'public-immutable' },
  video: { location: 'strip' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

## SVG: why the image intent refuses it, and the safe adapter

SVG is not an image to the asset pipeline — it is a document that can carry
script. Two deliberate mechanisms mean **you cannot simply add
`image/svg+xml` to an image intent's `accept.mediaTypes`**:

- **Trusted detection is byte-based and has no SVG entry.** Finalization
  names the content type from the bytes, not from the client's declaration.
  There is no SVG magic number, so an SVG body detects as
  `application/octet-stream`. Finalization then compares the *detected* type
  against the intent's accept list and fails the attempt with
  `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED` — the declaration was admitted at
  attempt-create and refused at the trusted boundary, which is confusing
  until you know why.
- **Delivery force-attaches active content.** `image/svg+xml` (with
  `text/html`, the XML types, JavaScript, and unrecognized
  `application/octet-stream`) is on the never-inline list under every
  delivery profile, so a stored SVG cannot become a same-origin script lane.

So the platform's answer for SVG is "opaque bytes, never rendered inline by
us". If your app genuinely needs SVG — a frozen source contract, an existing
corpus — the paved shape is an **application-owned adapter** in four steps.
The Zerobugs control implements it end to end (`C-ASSET` in its
[PLAN](repo:demos/zerobugs/control/PLAN.md)).

### 1. Validate exactly, server-side, before any upload starts

Your code — not the platform — is now the type authority, so the check must
be exact and it must run somewhere the client cannot reach. Match the
declared MIME against the declared length **and** against the actual bytes:

```ts source=demos/zerobugs/control/composition/server.mts
function mimeMatches(contentType: string, bytes: Uint8Array): boolean {
  const ascii = new TextDecoder('utf-8', {fatal: false}).decode(bytes.slice(0, 512));
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v);
  if (contentType === 'image/gif') return ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');
  if (contentType === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (contentType === 'image/svg+xml') return /^(?:\uFEFF|\s)*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(ascii);
  return false;
}
```

A signature test is a *shape* test, not a safety proof — an SVG that starts
with `<svg` may still contain script. That is why the delivery step below is
non-optional: the adapter's safety comes from the sandbox, and the signature
check only keeps non-SVG bytes out of the SVG lane.

### 2. Route SVG to a separately named opaque intent

Declare two intents, not one widened intent. The ordinary image intent keeps
the four detectable image types and the image pipeline; SVG gets its own
intent that accepts `application/octet-stream` and declares **no `image`
block** — no renditions, no ThumbHash, no width ladder:

```js source=demos/zerobugs/control/snapback/functions.mjs
// Native trusted MIME detection deliberately classifies active SVG as opaque.
// The gateway admits this intent only after its own exact SVG signature/type/
// length policy and serves the typed alias with the source MIME.
export const zerobugsSvgUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: ['identityBinding', 'user'],
  accept: {mediaTypes: ['application/octet-stream'], maxBytes: 10 * 1024 * 1024},
  delivery: {kind: 'public-immutable'},
  access: {read: 'via-references'},
  authorize: async (ctx) => {
    await requireSourceUser(ctx);
    return {owner: ctx.auth.userId};
  },
});
```

Upload the bytes under that intent with an octet-stream declaration, so the
declared type and the detected type agree:

```ts source=demos/zerobugs/control/composition/server.mts
            const svgOpaque = contentType === 'image/svg+xml';
            const upload = createAssetClient(session.client).start({
              upload: (svgOpaque ? api.zerobugsSvgUpload : api.zerobugsImageUpload) as never,
              file: new Blob([bytes], {type: svgOpaque ? 'application/octet-stream' : contentType}),
              declaredFilename: `${capability.key}.${extensionFor(contentType)}`,
              declaredContentType: svgOpaque ? 'application/octet-stream' : contentType,
            });
```

Two named intents is the point: an audit can see which assets went through
the trusted image detector and which went through your validator, and the
`authorize` boundary stays per-intent.

### 3. Attach through the typed `v.assetRef`, re-checking the pairing

The row keeps the real source MIME beside the typed reference. Because the
field must accept both intents, spell it `v.assetRef({ upload: null })` — the
explicit unrestricted, handler-attach-only form — and re-assert MIME↔intent
inside the attaching mutation so a caller cannot pair an SVG content type
with the trusted image intent:

```js source=demos/zerobugs/control/snapback/functions.mjs
    if (
      (args.contentType === 'image/svg+xml' && args.uploadKind !== 'svg-opaque')
      || (args.contentType !== 'image/svg+xml' && args.uploadKind !== 'image')
    ) throw new Error('asset upload intent was refused');
```

```js source=demos/zerobugs/control/snapback/functions.mjs
    const asset = args.uploadKind === 'svg-opaque'
      ? await ctx.assets.attach(args.assetID, {upload: 'zerobugsSvgUpload'})
      : await ctx.assets.attach(args.assetID, {upload: 'zerobugsImageUpload'});
```

### 4. Serve through your own alias with `nosniff` and a sandbox CSP

The native byte routes will not serve SVG inline, so the app owns a delivery
alias that reads the native bytes and re-labels them with the stored source
MIME. That re-labelling is what makes the sandbox headers mandatory — and
the CSP is applied only to the SVG type, not to every asset:

```ts source=demos/zerobugs/control/composition/server.mts
            return new Response(native.body, {
              status: 200,
              headers: {
                'content-type': String(row.contentType),
                ...(native.headers.get('content-length')
                  ? {'content-length': native.headers.get('content-length') as string}
                  : {}),
                'cache-control': 'public, max-age=31536000, immutable',
                'access-control-allow-origin': '*',
                'cross-origin-resource-policy': 'cross-origin',
                'x-content-type-options': 'nosniff',
                ...(row.contentType === 'image/svg+xml'
                  ? {'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"}
                  : {}),
              },
            });
```

`sandbox` with `default-src 'none'` is what neutralizes script inside the
document; `nosniff` stops a browser re-deciding the type. Serve the alias
from an origin that holds nothing worth stealing if the sandbox is ever
bypassed.

**What this recipe is and is not.** It is an application adapter that keeps
SVG inside the typed asset lifecycle (owned uploads, typed references,
reference GC, deletion refusal while referenced). It is **not** native SVG
support: there is no image pipeline for these assets — no declared variants,
no `width=` ladder, no ThumbHash placeholder, no dimension or dominant-color
facts — and no sanitizer. You own the validator, the alias route, and its
headers. The control's implementation is witnessed by its own
`test:lane5:live` route check and the retained ZB4/ZB7 receipts under
[`demos/zerobugs/evidence`](repo:demos/zerobugs/evidence), not by repository
CI. If you do not have a hard requirement, rasterize to PNG at the edge and
use the ordinary image intent.

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

Deletion is two truths, both deliberate: bytes die at the origin
immediately (delivery 404s on the next request), while the metadata row
lingers as a declared `availability: "deleted"` tombstone through its
retention window (default seven days — a GC sweep will not purge it
early). The tombstone is what lets clients and reverse-reference repair
observe *that* something was deleted rather than never existing; do not
read a 200 metadata response with `deleted` availability as a failed
delete.

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

## Export the asset component of a logical backup

The local target advertises `assets.export.cutExport: true`. Capture its asset
component into an absolute, empty-or-absent directory:

```sh
snapback assets export-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

The command opens one read transaction and pins its storage head as
`cutVersion`. That transaction captures all `ready` asset records and their
`ready` renditions, deleted-asset tombstones, each referenced immutable blob
exactly once, and the settled quota snapshot. It deliberately excludes
in-flight attempts, pending/rejected assets, staging bytes, and reverse
reference edges; the edges derive from application rows and belong to the
app-data export component.

After the transaction closes, Snapback copies the immutable blobs under
`blobs/sha256/`, verifies each copy against its recorded SHA-256 and length,
then writes `asset-cut.manifest.json` last. An unreadable or mismatched blob
fails the command instead of producing an admissible partial cut. The failed
directory may contain copied objects but no valid complete manifest; retry
into a new empty directory.

This is a **logical export component**, not a full application or SQLite
backup. The capability manifest still lists `asset-byte-backup` as Missing,
and a portable application export must coordinate the separately owned
app-data component.

### Validate the complete cut before restore

`importValidation: true` is the refuse-partial half of the shipped surface.
Without `--apply`, `import-cut` only validates the tagged manifest digest and
every declared blob object:

```sh
snapback assets import-cut \
  --dir "$PWD/backups/assets-2026-08-04" \
  --ready-file .snapback/server-ready.json
```

A missing object, changed byte length, digest mismatch, or tampered manifest
returns a structured refusal before any asset row lands. Restore application
is a separate experimental capability (`importApply: "experimental"`):
`--apply` requires the server-side `SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1`
acknowledgment and an empty asset state. It is not the paved full-app restore
path.

### Invalidate every outstanding signed URL

Rotate the instance signing key when every already-issued `private-signed`
URL must stop validating immediately:

```sh
snapback assets rotate-signing-key --ready-file .snapback/server-ready.json
```

Rotation retires every active signing key, mints a fresh one, and emits an
instance-scoped receipt without returning key ids or key material. New signed
URL issuance works under the fresh key. This is deliberately a wide operator
action; use ordinary authorization changes when the intent is to revoke one
principal rather than every outstanding signed bearer URL.

The local proof drives these exact native CLI commands against a real server,
checks the pinned manifest, observes an issued URL fail after rotation, and
proves incomplete-cut validation exits non-zero with the structured refusal:

```js source=tests/acceptance/asset-conformance-v1.mjs
  const rotation = await runAssetsCli(sessionsServer, 'rotate-signing-key');
  assert.equal(rotation.exitCode, 0);
  assert.equal(rotation.envelope.ok, true);
  assert.equal(rotation.envelope.data.rotated, true);
  const signedAfterRotation = await fetch(`${sessionsServer.baseUrl}${issuanceBody.url}`);
  assert.equal(signedAfterRotation.status, 403, 'rotation invalidates the outstanding signed URL');

  const exportDir = join(scratch, 'asset-cut-export');
  const exported = await runAssetsCli(sessionsServer, 'export-cut', '--dir', exportDir);
  assert.equal(exported.exitCode, 0);
  assert.equal(exported.envelope.ok, true);
  assert.equal(exported.envelope.data.cut.formatVersion, 'snapback.asset-cut.v1');
  assert.ok(exported.envelope.data.cut.assetCount > 0);
  assert.ok(exported.envelope.data.cut.blobCount > 0);
  const cutManifest = await readJson(join(exportDir, 'asset-cut.manifest.json'));
  assert.equal(cutManifest.cutVersion, exported.envelope.data.cut.cutVersion);
  assert.equal(cutManifest.manifestDigest, exported.envelope.data.cut.manifestDigest);

  await rm(join(exportDir, cutManifest.blobs[0].objectPath));
  const incomplete = await runAssetsCli(sessionsServer, 'import-cut', '--dir', exportDir);
  assert.notEqual(incomplete.exitCode, 0);
  assert.equal(incomplete.envelope.ok, false);
  assert.equal(incomplete.envelope.diagnostics[0].code, 'SNAPBACK_ASSET_IMPORT_INCOMPLETE');
  checks.nativeCliCutExportAndRotation = true;
```

## Evidence and limits

The acceptance traceability map is
[`tests/acceptance/asset-lifecycle-v1-evidence.md`](../../tests/acceptance/asset-lifecycle-v1-evidence.md);
the manifest facts (stores, profiles, integrity grades, enforced limits,
and the explicit Missing nonclaims — byte backup, custom read
authorizers, deferred length) live in
`schemas/capability.manifest.local-dev-sqlite-ibex.json` under `assets`.
Live no-polling readiness ships as the reserved `_snapback.assetRecord`
projection (subscribe via the asset client's `watch`/`watchStore`), and
the framework-neutral upload task comes from the `@expo/snapback-client/assets`
entry: `createAssetClient(client)` wraps your `SnapbackClient`, and
`createAssetClient(client).start({ upload, args, file })` is the task
(there is no `client.assets` accessor on `SnapbackClient` itself); the
React/Expo hook and renderer are
`useSnapbackAssetUpload` / `useSnapbackAssetImage` in
`@expo/snapback-react`, and the real-server JS conformance vectors are
`tests/acceptance/asset-conformance-v1.mjs`.

The declared limits are preflightable, not discover-by-failure: the
attempt-create response's `transfer.maxChunkBytes` carries the chunk
ceiling (the packaged client narrows its chunk size to it
automatically), every TUS response advertises `Tus-Version`,
`Tus-Extension`, `Tus-Checksum-Algorithm`, and `Snapback-Max-Chunk-Bytes`
on the wire, and the manifest's `assets` block declares the byte, quota,
TTL, and count ceilings a suite can read before sending a byte. Ready
records expose the canonical `digest`, `digestAlgorithm`, and
`integrityGrade` as ordinary queryable facts on the record view and
`snapback assets inspect`.

## Anti-patterns

- **Do not post to `/signed-url` or cache bearer URLs by hand.** Use
  [`assets.signedUrl`, `issuedUrlStore`, or `useSnapbackAssetUrl`](#issue-and-refresh-a-private-signed-url)
  so custody, absolute URLs, authority blanking, and TTL refresh keep one
  owner.
- **Do not treat `task.done` resolution as upload success without checking its
  terminal row.** Use [`assets.upload()`](#upload-when-you-only-need-the-ready-asset-id)
  for settle-or-reject behavior, or branch on all four raw terminal statuses.
- **Do not add a second recipient-readable reference to view-once media.** Keep
  either the [first-class grant edge](#grant-and-revoke-per-recipient-access)
  from the [view-once media recipe](../recipes/view-once-media.md), or the
  [fallback app-owned grant row](#portable-fallback-app-owned-grant-rows), as
  the recipient's sole authority path. Retain an owner-only typed reverse
  reference through the pending window so reference GC cannot reclaim the
  asset before open or cancellation.
